//! H34: avoid inline hook selectors that capture render state.

use oxc_ast::ast::{CallExpression, Expression, Program};

use crate::rules::report;
use crate::rules::support::closures::{build_semantic, captures_outside};
use crate::rules::support::walk::{walk_rule, Context, RenderKind, Rule};
use crate::{Diagnostic, Source};

/// The diagnostic id registered by the rule table.
pub const RULE: &str = "carburetor/no-capturing-hook-selector";

const MESSAGE: &str = "This inline hook selector captures render state and is rebuilt every render. Use AntiHookComponent#useCarburetor without a selector, or select the whole record and pick in render.";

struct Check<'a, 's> {
    source: &'s Source<'s>,
    semantic: &'s oxc_semantic::Semantic<'a>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a> Rule<'a> for Check<'a, '_> {
    fn finish(self) -> Vec<Diagnostic> {
        self.diagnostics
    }

    fn call(&mut self, call: &CallExpression<'a>, context: &Context) {
        if !context.in_render || context.render_kind != Some(RenderKind::Function) {
            return;
        }

        let hook = match call.callee.get_inner_expression() {
            Expression::Identifier(identifier) => match identifier.name.as_str() {
                "useCarburetorValue" => Some(1),
                "useResourceValue" => Some(2),
                _ => None,
            },
            _ => None,
        };
        let Some(selector_index) = hook else {
            return;
        };

        let owner = context.render_scope.unwrap_or(context.function);
        let Some(selector) = call.arguments.get(selector_index).and_then(|argument| {
            let expression = argument.as_expression()?;
            match expression.get_inner_expression() {
                Expression::ArrowFunctionExpression(arrow) => Some((
                    arrow.span,
                    captures_outside(arrow.as_ref(), self.semantic, owner),
                )),
                Expression::FunctionExpression(function) => Some((
                    function.span,
                    captures_outside(function.as_ref(), self.semantic, owner),
                )),
                _ => None,
            }
        }) else {
            return;
        };

        if selector.1 {
            self.diagnostics.push(report(self.source, selector.0.start, RULE, MESSAGE.to_string()));
        }
    }
}

/// Reports inline store-hook selectors that capture their component's render bindings.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    let semantic = build_semantic(program);

    check_with_semantic(program, source, &semantic)
}

/// Runs the rule with a semantic pass shared across rules.
pub(in crate::rules) fn check_with_semantic<'a, 's>(
    program: &Program<'a>,
    source: &'s Source<'s>,
    semantic: &'s oxc_semantic::Semantic<'a>,
) -> Vec<Diagnostic> {
    walk_rule(program, Check { source, semantic, diagnostics: Vec::new() })
}

#[cfg(test)]
mod tests;
