use oxc_ast::ast::{ArrowFunctionBody, CallExpression, Expression, JSXAttributeValue};
use oxc_ast_visit::Visit;

use oxc_semantic::Semantic;
use oxc_span::{GetSpan, Span};

use crate::rules::support::names::{member_call_name, referenced_symbol, unwrap_expression};

/// Collect function allocations represented by an expression, without scanning into function bodies.
pub fn fresh_functions(expression: &Expression<'_>, out: &mut Vec<Span>) {
    match unwrap_expression(expression) {
        Expression::ArrowFunctionExpression(arrow) => out.push(arrow.span),
        Expression::FunctionExpression(function) => out.push(function.span),
        Expression::CallExpression(call) => fresh_call(call, out),
        Expression::ConditionalExpression(conditional) => {
            fresh_functions(&conditional.consequent, out);
            fresh_functions(&conditional.alternate, out);
        }
        Expression::LogicalExpression(logical) => {
            fresh_functions(&logical.left, out);
            fresh_functions(&logical.right, out);
        }
        _ => {}
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
        for identifier in hooks {
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

fn collect_hook_handler_refs<'a>(expression: &'a Expression<'a>, out: &mut Vec<&'a oxc_ast::ast::IdentifierReference<'a>>) {
    match unwrap_expression(expression) {
        Expression::CallExpression(call) => {
            if is_hook_call(call, "useCallback") {
                if let Some(Expression::Identifier(identifier)) = call.arguments.first().and_then(|argument| argument.as_expression()).map(unwrap_expression) { out.push(identifier); }
            } else if is_hook_call(call, "useMemo") {
                if let Some(factory) = call.arguments.first().and_then(|argument| argument.as_expression()).map(unwrap_expression) {
                    match factory {
                        Expression::ArrowFunctionExpression(arrow) => match &arrow.body {
                            ArrowFunctionBody::FunctionBody(body) => for statement in &body.statements { if let oxc_ast::ast::Statement::ReturnStatement(returned) = statement { if let Some(value) = &returned.argument { if let Expression::Identifier(identifier) = unwrap_expression(value) { out.push(identifier); } } } },
                            body => if let Some(value) = body.as_expression() { if let Expression::Identifier(identifier) = unwrap_expression(value) { out.push(identifier); } },
                        },
                        Expression::FunctionExpression(function) => if let Some(body) = &function.body { for statement in &body.statements { if let oxc_ast::ast::Statement::ReturnStatement(returned) = statement { if let Some(value) = &returned.argument { if let Expression::Identifier(identifier) = unwrap_expression(value) { out.push(identifier); } } } } },
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
