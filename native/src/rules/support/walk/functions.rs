use oxc_ast::ast::{ArrowFunctionBody, CallExpression, Expression, JSXAttributeValue};
use oxc_ast_visit::Visit;

use oxc_semantic::Semantic;
use oxc_span::{GetSpan, Span};

use crate::rules::support::names::{member_call_name, referenced_symbol, unwrap_expression};

/// Collect function allocations represented by an expression, without scanning into function bodies.
pub fn fresh_functions(expression: &Expression<'_>, out: &mut Vec<Span>) {
    let expression = unwrap_expression(expression);
    match expression {
        Expression::ArrowFunctionExpression(arrow) => out.push(arrow.span),
        Expression::FunctionExpression(function) => out.push(function.span),
        Expression::CallExpression(call) => fresh_call(call, out),
        Expression::ConditionalExpression(_) | Expression::LogicalExpression(_) => {
            if let Some((left, right)) = value_branches(expression) {
                fresh_functions(left, out);
                fresh_functions(right, out);
            }
        }
        _ => {}
    }
}

/// The two branches of a conditional or logical expression whose value the expression yields.
///
/// The `test` of a conditional only selects between the branches and hands no function anywhere,
/// so every pass that collects functions behind conditionals and every pass that excludes them —
/// the fresh-function walk here, the module scan and the class scan — must agree on this pair.
pub fn value_branches<'a>(expression: &'a Expression<'a>) -> Option<(&'a Expression<'a>, &'a Expression<'a>)> {
    match expression {
        Expression::ConditionalExpression(conditional) => Some((&conditional.consequent, &conditional.alternate)),
        Expression::LogicalExpression(logical) => Some((&logical.left, &logical.right)),
        _ => None,
    }
}

/// Collect function allocations represented by an attribute expression.
pub fn fresh_attribute_functions(value: &Option<JSXAttributeValue<'_>>, out: &mut Vec<Span>) {
    fresh_attribute_functions_resolved(value, out, None, None);
}

/// Collect function allocations, including local bindings initialized by function-valued hooks.
pub fn fresh_attribute_functions_resolved(
    value: &Option<JSXAttributeValue<'_>>,
    out: &mut Vec<Span>,
    semantic: Option<&Semantic<'_>>,
    render_scope: Option<Span>,
) {
    let Some(JSXAttributeValue::ExpressionContainer(container)) = value else {
        return;
    };
    if let Some(expression) = container.expression.as_expression() {
        fresh_functions(expression, out);
        let (Some(semantic), Some(scope)) = (semantic, render_scope) else { return; };
        let mut hooks = Vec::new();
        collect_hook_handler_refs(expression, &mut hooks);
        for (_, identifier) in hooks {
            let Some(symbol) = referenced_symbol(identifier, semantic) else { continue; };
            let declaration = semantic.scoping().symbol_declaration(symbol);
            let span = match semantic.nodes().kind(declaration) {
                oxc_ast::AstKind::VariableDeclarator(declarator) => {
                    if !contains_span(scope, declarator.span) { continue; }
                    let Some(initializer) = &declarator.init else { continue; };
                    match unwrap_expression(initializer) {
                        Expression::ArrowFunctionExpression(arrow) => arrow.span,
                        Expression::FunctionExpression(function) => function.span,
                        _ => continue,
                    }
                }
                oxc_ast::AstKind::Function(function) => {
                    if !contains_span(scope, function.span) { continue; }
                    function.span
                }
                _ => continue,
            };
            if !out.contains(&span) { out.push(span); }
        }
    }
}

fn contains_span(scope: Span, span: Span) -> bool {
    scope.start <= span.start && span.end <= scope.end
}

/// Function-valued bindings a hook hands through: `(hook argument span, reference)` pairs.
///
/// `useCallback(handler)` hands `handler` over; each function a `useMemo` factory `return`s by
/// name is handed through its factory. The span is the hook argument the binding travels through.
fn collect_hook_handler_refs<'a>(expression: &'a Expression<'a>, out: &mut Vec<(Span, &'a oxc_ast::ast::IdentifierReference<'a>)>) {
    match unwrap_expression(expression) {
        Expression::CallExpression(call) => {
            if is_hook_call(call, "useCallback") {
                if let Some(argument) = call.arguments.first().and_then(|argument| argument.as_expression()).map(unwrap_expression) {
                    if let Expression::Identifier(identifier) = argument { out.push((argument.span(), identifier)); }
                }
            } else if is_hook_call(call, "useMemo") {
                if let Some(factory) = call.arguments.first().and_then(|argument| argument.as_expression()).map(unwrap_expression) {
                    match factory {
                        Expression::ArrowFunctionExpression(arrow) => match &arrow.body {
                            ArrowFunctionBody::FunctionBody(body) => collect_returned_references(arrow.span, body, out),
                            body => if let Some(value) = body.as_expression() { if let Expression::Identifier(identifier) = unwrap_expression(value) { out.push((arrow.span, identifier)); } },
                        },
                        Expression::FunctionExpression(function) => if let Some(body) = &function.body { collect_returned_references(function.span, body, out); },
                        _ => {}
                    }
                }
            }
        }
        Expression::ConditionalExpression(node) => { collect_hook_handler_refs(&node.consequent, out); collect_hook_handler_refs(&node.alternate, out); }
        Expression::LogicalExpression(node) => { collect_hook_handler_refs(&node.left, out); collect_hook_handler_refs(&node.right, out); }
        _ => {}
    }
}

/// Collects the identifiers a factory `return`s, descending into nested statements — blocks,
/// branches, loops, `switch` and `try` — but not into nested functions: a `return` below a
/// nested function belongs to that function, not to the hook.
fn collect_returned_references<'a>(factory: Span, body: &'a oxc_ast::ast::FunctionBody<'a>, out: &mut Vec<(Span, &'a oxc_ast::ast::IdentifierReference<'a>)>) {
    for statement in &body.statements {
        collect_returned_references_statement(factory, statement, out);
    }
}

fn collect_returned_references_block<'a>(factory: Span, block: &'a oxc_ast::ast::BlockStatement<'a>, out: &mut Vec<(Span, &'a oxc_ast::ast::IdentifierReference<'a>)>) {
    for statement in &block.body {
        collect_returned_references_statement(factory, statement, out);
    }
}

fn collect_returned_references_statement<'a>(factory: Span, statement: &'a oxc_ast::ast::Statement<'a>, out: &mut Vec<(Span, &'a oxc_ast::ast::IdentifierReference<'a>)>) {
    match statement {
        oxc_ast::ast::Statement::ReturnStatement(returned) => {
            if let Some(value) = &returned.argument {
                if let Expression::Identifier(identifier) = unwrap_expression(value) { out.push((factory, identifier)); }
            }
        }
        oxc_ast::ast::Statement::BlockStatement(block) => collect_returned_references_block(factory, block, out),
        oxc_ast::ast::Statement::IfStatement(if_statement) => {
            collect_returned_references_statement(factory, &if_statement.consequent, out);
            if let Some(alternate) = &if_statement.alternate { collect_returned_references_statement(factory, alternate, out); }
        }
        oxc_ast::ast::Statement::SwitchStatement(switch_statement) => {
            for case in &switch_statement.cases {
                for nested in &case.consequent { collect_returned_references_statement(factory, nested, out); }
            }
        }
        oxc_ast::ast::Statement::TryStatement(try_statement) => {
            collect_returned_references_block(factory, &try_statement.block, out);
            if let Some(handler) = &try_statement.handler { collect_returned_references_block(factory, &handler.body, out); }
            if let Some(finalizer) = &try_statement.finalizer { collect_returned_references_block(factory, finalizer, out); }
        }
        oxc_ast::ast::Statement::WhileStatement(while_statement) => collect_returned_references_statement(factory, &while_statement.body, out),
        oxc_ast::ast::Statement::DoWhileStatement(do_while_statement) => collect_returned_references_statement(factory, &do_while_statement.body, out),
        oxc_ast::ast::Statement::ForStatement(for_statement) => collect_returned_references_statement(factory, &for_statement.body, out),
        oxc_ast::ast::Statement::ForInStatement(for_in_statement) => collect_returned_references_statement(factory, &for_in_statement.body, out),
        oxc_ast::ast::Statement::ForOfStatement(for_of_statement) => collect_returned_references_statement(factory, &for_of_statement.body, out),
        oxc_ast::ast::Statement::LabeledStatement(labeled_statement) => collect_returned_references_statement(factory, &labeled_statement.body, out),
        oxc_ast::ast::Statement::WithStatement(with_statement) => collect_returned_references_statement(factory, &with_statement.body, out),
        _ => {}
    }
}

/// Collect function allocations in an initializer, resolving functions a hook factory builds and
/// returns inside itself. A handler the hook merely passes through is diagnosed where it is
/// declared, so only declarations inside the hook's own argument are collected.
pub fn fresh_declaration_functions(init: &Expression<'_>, out: &mut Vec<Span>, semantic: &Semantic<'_>) {
    fresh_functions(init, out);

    let mut passed = Vec::new();
    collect_hook_handler_refs(init, &mut passed);
    for (boundary, identifier) in passed {
        let Some(symbol) = referenced_symbol(identifier, semantic) else { continue; };
        let declaration = semantic.scoping().symbol_declaration(symbol);
        if !contains_span(boundary, semantic.nodes().kind(declaration).span()) { continue; }
        let span = match semantic.nodes().kind(declaration) {
            oxc_ast::AstKind::VariableDeclarator(declarator) => {
                let Some(initializer) = &declarator.init else { continue; };
                match unwrap_expression(initializer) {
                    Expression::ArrowFunctionExpression(arrow) => arrow.span,
                    Expression::FunctionExpression(function) => function.span,
                    _ => continue,
                }
            }
            oxc_ast::AstKind::Function(function) => function.span,
            _ => continue,
        };
        if !out.contains(&span) { out.push(span); }
    }
}

pub(crate) fn fresh_call(call: &CallExpression<'_>, out: &mut Vec<Span>) {
    if member_call_name(&call.callee) == Some("bind") {
        out.push(call.span);
        return;
    }

    if is_hook_call(call, "useCallback") {
        if let Some(argument) = call.arguments.first().and_then(|argument| argument.as_expression()) {
            let argument = unwrap_expression(argument);
            match argument {
                Expression::ArrowFunctionExpression(arrow) => out.push(arrow.span),
                Expression::FunctionExpression(function) => out.push(function.span),
                Expression::CallExpression(bind) if member_call_name(&bind.callee) == Some("bind") => {
                    out.push(argument.span());
                }
                _ => {}
            }
        }
    } else if is_hook_call(call, "useMemo") {
        if let Some(argument) = call.arguments.first().and_then(|argument| argument.as_expression()) {
            match unwrap_expression(argument) {
                Expression::ArrowFunctionExpression(arrow) => {
                    let mut returns = ReturnAllocations { out };
                    match &arrow.body {
                        ArrowFunctionBody::FunctionBody(body) => returns.visit_function_body(body),
                        body => {
                            if let Some(value) = body.as_expression() {
                                fresh_functions(value, returns.out);
                            }
                        }
                    }
                }
                Expression::FunctionExpression(function) => {
                    let mut returns = ReturnAllocations { out };
                    if let Some(body) = &function.body {
                        returns.visit_function_body(body);
                    }
                }
                _ => {}
            }
        }
    }
}

struct ReturnAllocations<'o> {
    out: &'o mut Vec<Span>,
}

impl<'a> Visit<'a> for ReturnAllocations<'_> {
    fn visit_function(&mut self, _function: &oxc_ast::ast::Function<'a>, _flags: oxc_syntax::scope::ScopeFlags) {}

    fn visit_arrow_function_expression(
        &mut self,
        _arrow: &oxc_ast::ast::ArrowFunctionExpression<'a>,
    ) {}

    fn visit_class(&mut self, _class: &oxc_ast::ast::Class<'a>) {}

    fn visit_return_statement(&mut self, returned: &oxc_ast::ast::ReturnStatement<'a>) {
        if let Some(value) = &returned.argument {
            fresh_functions(value, self.out);
        }
    }
}

fn is_hook_call(call: &CallExpression<'_>, hook: &str) -> bool {
    match &call.callee {
        Expression::Identifier(identifier) => identifier.name == hook,
        Expression::StaticMemberExpression(member) => {
            member.property.name == hook
                && matches!(&member.object, Expression::Identifier(identifier) if identifier.name == "React")
        }
        _ => false,
    }
}
