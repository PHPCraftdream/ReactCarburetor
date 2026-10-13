//! Opt-in component architecture: React hooks belong outside hook-free components.

use oxc_ast::ast::{CallExpression, Expression, FunctionBody, Program, ReturnStatement};
use oxc_ast::AstKind;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::{NodeId, Semantic};
use oxc_syntax::scope::ScopeFlags;

use crate::rules::report;
use crate::rules::support::closures::{build_semantic, is_component_class};
use crate::{Diagnostic, Source};

mod bindings;
#[cfg(test)]
mod tests;

use bindings::{is_hook_name, ReactBindings};

/// The optional rule's public diagnostic id.
pub const RULE: &str = "carburetor/no-react-hooks-in-components";

/// React component names begin with an uppercase ASCII letter.
fn component_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}

/// Whether a returned expression produces JSX without inspecting nested functions.
fn jsx_result(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::JSXElement(_) | Expression::JSXFragment(_) => true,
        Expression::ConditionalExpression(value) => {
            jsx_result(&value.consequent) || jsx_result(&value.alternate)
        }
        Expression::LogicalExpression(value) => jsx_result(&value.left) || jsx_result(&value.right),
        Expression::SequenceExpression(value) => value.expressions.last().is_some_and(jsx_result),
        _ => false,
    }
}

struct ReturnsJsx {
    found: bool,
}

impl<'a> Visit<'a> for ReturnsJsx {
    fn visit_function(&mut self, _: &oxc_ast::ast::Function<'a>, _: ScopeFlags) {}

    fn visit_arrow_function_expression(&mut self, _: &oxc_ast::ast::ArrowFunctionExpression<'a>) {}

    fn visit_class(&mut self, _: &oxc_ast::ast::Class<'a>) {}

    fn visit_return_statement(&mut self, value: &ReturnStatement<'a>) {
        self.found |= value.argument.as_ref().is_some_and(jsx_result);
    }
}

/// Checks only this function's own returns, including returns nested in control flow.
fn returns_jsx(body: &FunctionBody<'_>) -> bool {
    let mut scan = ReturnsJsx { found: false };
    scan.visit_function_body(body);
    scan.found
}

struct Check<'a, 's> {
    source: &'s Source<'s>,
    semantic: &'s Semantic<'a>,
    bindings: ReactBindings<'a>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a> Check<'a, '_> {
    fn component_class(&self, class: &oxc_ast::ast::Class<'a>) -> bool {
        is_component_class(class, self.semantic)
            || class
                .heritage
                .as_ref()
                .and_then(|heritage| self.bindings.call_name(&heritage.expression, self.semantic))
                .is_some_and(|name| matches!(name, "Component" | "PureComponent"))
    }

    /// Anonymous callbacks of React memo/forwardRef and default exports are components too.
    fn component_binding(&self, id: NodeId) -> bool {
        for parent in self.semantic.nodes().ancestor_kinds(id) {
            match parent {
                AstKind::VariableDeclarator(declaration) => {
                    return declaration
                        .id
                        .get_binding_identifier()
                        .is_some_and(|name| component_name(name.name.as_str()));
                }
                AstKind::ExportDefaultDeclaration(_) => return true,
                AstKind::CallExpression(call) => {
                    return self
                        .bindings
                        .call_name(&call.callee, self.semantic)
                        .is_some_and(|name| matches!(name, "memo" | "forwardRef"));
                }
                AstKind::MethodDefinition(_) | AstKind::PropertyDefinition(_) => {
                    return self.semantic.nodes().ancestor_kinds(id).any(
                        |kind| matches!(kind, AstKind::Class(class) if self.component_class(class)),
                    );
                }
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) | AstKind::Class(_) => {
                    return false;
                }
                _ => {}
            }
        }
        false
    }

    /// Finds a component owner rather than treating every use-prefixed utility as a component.
    fn in_component(&self, call: &CallExpression<'a>) -> bool {
        for parent in self.semantic.nodes().ancestor_kinds(call.node_id.get()) {
            match parent {
                AstKind::Function(function) => {
                    if function
                        .id
                        .as_ref()
                        .is_some_and(|id| component_name(id.name.as_str()))
                        || self.component_binding(function.node_id.get())
                        || function.body.as_ref().is_some_and(|body| returns_jsx(body))
                    {
                        return true;
                    }
                }
                AstKind::ArrowFunctionExpression(function) => {
                    let jsx = match &function.body {
                        oxc_ast::ast::ArrowFunctionBody::FunctionBody(body) => returns_jsx(body),
                        body => body.as_expression().is_some_and(jsx_result),
                    };
                    if jsx || self.component_binding(function.node_id.get()) {
                        return true;
                    }
                }
                AstKind::Class(class) => return self.component_class(class),
                _ => {}
            }
        }
        false
    }
}

impl<'a> Visit<'a> for Check<'a, '_> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if let Some(name) = self.bindings.call_name(&call.callee, self.semantic) {
            if is_hook_name(name) && self.in_component(call) {
                self.diagnostics.push(report(self.source, call.span.start, RULE, format!(
                    "React {name}() is forbidden in hook-free components. Use AntiHookComponent's \
                     instance-owned state, reads and effects, or leave this optional preset disabled. \
                     Hook-free code reduces render-time ownership work; it does not guarantee zero GC."
                )));
            }
        }
        walk::walk_call_expression(self, call);
    }
}

/// Runs only when explicitly enabled; files without React value imports need no semantic pass.
pub fn check(program: &Program<'_>, source: &Source<'_>) -> Vec<Diagnostic> {
    if !ReactBindings::has_react_source(program) {
        return Vec::new();
    }
    let semantic = build_semantic(program);
    let bindings = ReactBindings::from_program(program);
    let mut check = Check {
        source,
        semantic: &semantic,
        bindings,
        diagnostics: Vec::new(),
    };
    check.visit_program(program);
    check.diagnostics
}
