use std::collections::HashSet;

use oxc_ast::ast::{
    Argument, ArrowFunctionExpression, BindingPattern, CallExpression, Class,
    Expression, Function, Program, ReturnStatement, VariableDeclarator,
};
use oxc_ast_visit::{walk, Visit};
use oxc_span::Span;
use oxc_syntax::scope::ScopeFlags;

use super::unwrap_expression;

pub(super) fn discover(program: &Program<'_>) -> HashSet<Span> {
    struct Discovery(HashSet<Span>);

    impl<'a> Visit<'a> for Discovery {
        fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
            if function.is_function_declaration()
                && function
                    .id
                    .as_ref()
                    .is_some_and(|id| pascal_case(id.name.as_str()))
                && function.body.as_ref().is_some_and(|body| returns_jsx(body))
            {
                self.0.insert(function.span);
            }
            walk::walk_function(self, function, flags);
        }

        fn visit_variable_declarator(&mut self, declarator: &VariableDeclarator<'a>) {
            if let BindingPattern::BindingIdentifier(id) = &declarator.id {
                if pascal_case(id.name.as_str()) {
                    if let Some(span) = declarator
                        .init
                        .as_ref()
                        .and_then(|init| component_value(unwrap_expression(init)))
                    {
                        self.0.insert(span);
                    }
                }
            }
            walk::walk_variable_declarator(self, declarator);
        }

        fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
            if allowed_wrapper(&call.callee) {
                if let Some(argument) = call.arguments.first().and_then(Argument::as_expression) {
                    if let Some(span) = component_value(unwrap_expression(argument)) {
                        self.0.insert(span);
                    }
                }
            }
            walk::walk_call_expression(self, call);
        }

        fn visit_class(&mut self, class: &Class<'a>) {
            walk::walk_class(self, class);
        }
    }

    let mut discovery = Discovery(HashSet::new());
    discovery.visit_program(program);
    discovery.0
}

fn component_value(expression: &Expression<'_>) -> Option<Span> {
    match expression {
        Expression::ArrowFunctionExpression(arrow) if arrow_returns_jsx(arrow) => Some(arrow.span),
        Expression::FunctionExpression(function)
            if function.body.as_ref().is_some_and(|body| returns_jsx(body)) =>
        {
            Some(function.span)
        }
        _ => None,
    }
}

fn allowed_wrapper(callee: &Expression<'_>) -> bool {
    match callee {
        Expression::Identifier(id) => matches!(id.name.as_str(), "memo" | "forwardRef"),
        Expression::StaticMemberExpression(member) => {
            matches!(&member.object, Expression::Identifier(id) if id.name == "React")
                && matches!(member.property.name.as_str(), "memo" | "forwardRef")
        }
        _ => false,
    }
}

fn pascal_case(name: &str) -> bool {
    name.chars().next().is_some_and(char::is_uppercase)
}

fn returns_jsx(body: &oxc_ast::ast::FunctionBody<'_>) -> bool {
    struct ReturnScan(bool);
    impl<'a> Visit<'a> for ReturnScan {
        fn visit_function(&mut self, _: &Function<'a>, _: ScopeFlags) {}
        fn visit_arrow_function_expression(&mut self, _: &ArrowFunctionExpression<'a>) {}
        fn visit_class(&mut self, _: &Class<'a>) {}
        fn visit_return_statement(&mut self, statement: &ReturnStatement<'a>) {
            self.0 |= statement.argument.as_ref().is_some_and(jsx_result);
        }
    }

    let mut scan = ReturnScan(false);
    scan.visit_function_body(body);
    scan.0
}

fn arrow_returns_jsx(arrow: &ArrowFunctionExpression<'_>) -> bool {
    if let Some(expression) = arrow.body.as_expression() {
        jsx_result(expression)
    } else if let oxc_ast::ast::ArrowFunctionBody::FunctionBody(body) = &arrow.body {
        returns_jsx(body)
    } else {
        false
    }
}

fn jsx_result(expression: &Expression<'_>) -> bool {
    match unwrap_expression(expression) {
        Expression::JSXElement(_) | Expression::JSXFragment(_) => true,
        Expression::ConditionalExpression(value) => {
            jsx_result(&value.consequent) || jsx_result(&value.alternate)
        }
        Expression::LogicalExpression(value) => jsx_result(&value.left) || jsx_result(&value.right),
        Expression::SequenceExpression(value) => value.expressions.last().is_some_and(jsx_result),
        _ => false,
    }
}
