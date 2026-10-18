//! H20: a subscription whose id is thrown away.
//!
//! The carburetor holds the callback, and the callback holds everything it closed over, for the
//! lifetime of the store. Nothing fails: memory grows and the callback keeps firing after the thing
//! it served is gone. `watch(select, onChange)` returns a disposer instead, which makes the cleanup
//! impossible to forget; components need neither, since `useCarburetor` subscribes and
//! `componentWillUnmount` releases.
//!
//! A subscription made with an explicit `{id}` is not reported: the caller kept a handle and can
//! release or replace it by that id, which is exactly how the engine subscribes components and
//! computed values. See docs/hazards.md, H20.

use oxc_ast::ast::{CallExpression, Expression, ObjectPropertyKind, Program};
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::{Scoping, Semantic};
use oxc_span::{GetSpan, Span};

use crate::rules::report;
use crate::rules::support::closures::build_semantic;
use crate::rules::support::names::{member_call_name, property_key_name, unwrap_expression};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/require-subscription-disposal";

const MESSAGE: &str = "this subscription's id is discarded, so it can never be released: the store \
    keeps the callback, and everything it closed over, for the lifetime of the process. Use \
    watch(select, onChange), which returns a disposer, or keep the id and unsubscribe.";

/// Whether the expression is the literal `null`, `void 0`, or an unresolved (global) `undefined`;
/// a resolved shadowing binding named `undefined` is unknown options, not nullish.
fn is_explicit_nullish(expression: &Expression<'_>, scoping: &Scoping) -> bool {
    match expression {
        Expression::NullLiteral(_) => true,
        Expression::UnaryExpression(unary) => unary.operator.is_void(),
        Expression::Identifier(identifier) => identifier.name == "undefined"
            && identifier
                .reference_id
                .get()
                .and_then(|id| scoping.get_reference(id).symbol_id())
                .is_none(),
        _ => false,
    }
}

/// Whether the subscription was given a stable id, which is a handle to release it by.
///
/// Only an object literal can be inspected; options built elsewhere (a forwarded parameter, a
/// helper's result, a trailing spread) may carry the caller's id, so they are not reported.
fn has_stable_id(call: &CallExpression<'_>, scoping: &Scoping) -> bool {
    let Some(argument) = call.arguments.last() else {
        return false;
    };
    // A trailing spread hands over options this rule cannot inspect.
    let Some(options) = argument.as_expression() else {
        return true;
    };
    if call.arguments.len() < 2 {
        return false;
    }
    let options = unwrap_expression(options);
    let Expression::ObjectExpression(options) = options else {
        return !is_explicit_nullish(options, scoping);
    };

    options.properties.iter().any(|property| match property {
        ObjectPropertyKind::ObjectProperty(property) => property_key_name(&property.key) == Some("id"),
        // A spread may bring the caller's id along.
        ObjectPropertyKind::SpreadProperty(_) => true,
    })
}

struct Check<'s> {
    source: &'s Source<'s>,
    semantic: &'s Semantic<'s>,
    diagnostics: Vec<Diagnostic>,
    /// Span of the expression whose value is discarded, if currently visiting it.
    discarded_expression: Option<Span>,
}

impl<'a, 's> Visit<'a> for Check<'s> {
    fn visit_expression_statement(&mut self, statement: &oxc_ast::ast::ExpressionStatement<'a>) {
        let previous = self.discarded_expression;
        self.discarded_expression = Some(unwrap_expression(&statement.expression).span());
        self.visit_expression(&statement.expression);
        self.discarded_expression = previous;
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if self.discarded_expression == Some(call.span)
            && member_call_name(&call.callee) == Some("subscribe")
            && !has_stable_id(call, self.semantic.scoping())
        {
            self.diagnostics.push(report(self.source, call.span.start, RULE, MESSAGE.to_string()));
        }

        walk::walk_call_expression(self, call);
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    let semantic = build_semantic(program);
    let mut check =
        Check { source, semantic: &semantic, diagnostics: Vec::new(), discarded_expression: None };

    check.visit_program(program);

    check.diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    #[test]
    fn a_discarded_subscription_is_reported() {
        assert_eq!(lines(&diagnose("store.subscribe(callback);\n", check)), [1]);
    }

    #[test]
    fn a_subscription_with_a_stable_id_is_correct() {
        let source = "store.subscribe(callback, {id: 'row-1'});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn subscription_nested_in_callback_statement_is_not_discarded() {
        let source = "outer(() => {\n    const id = store.subscribe(callback);\n    use(id);\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn round_five_kept_return_with_undefined_and_null_options_is_not_discarded() {
        for value in ["undefined", "null"] {
            let source = format!("const id = store.subscribe(callback, {value});\n");
            assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0], "{value}");
        }
    }

    #[test]
    fn round_five_shadowed_undefined_options_are_unknown() {
        let source = "function attach(undefined) { store.subscribe(callback, undefined); }\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn round_four_discarded_undefined_and_null_options_are_reported() {
        for options in ["undefined", "null"] {
            let source = format!("store.subscribe(callback, {options});\n");
            assert_eq!(lines(&diagnose(&source, check)), [1], "{options}");
        }
    }

    #[test]
    fn round_six_discarded_void_zero_options_are_reported() {
        assert_eq!(lines(&diagnose("store.subscribe(callback, void 0);\n", check)), [1]);
    }

    #[test]
    fn discarded_subscription_with_unknown_options_or_spread_is_not_reported() {
        for options in ["options", "{...options}"] {
            let source = format!("store.subscribe(callback, {options});\n");
            assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0], "{options}");
        }
    }

    #[test]
    fn options_built_elsewhere_may_carry_the_callers_id() {
        for options in ["options", "buildOptions(id)", "{...options}"] {
            let source = format!("store.subscribe(callback, {options});
");
            assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0], "{options}");
        }
        let source = "computedDependencies.subscribe(source, callback, options);
";
        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn assigned_subscription_return_value_is_not_discarded() {
        let source = "id = source.subscribe(onSourceChange, options);\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_kept_return_value_is_a_handle() {
        assert_eq!(lines(&diagnose("const id = store.subscribe(callback);\n", check)), [] as [usize; 0]);
    }

    #[test]
    fn subscribe_with_reads_but_no_id_is_still_discarded() {
        let source = "store.subscribe(callback, {reads: ['a']});\n";

        assert_eq!(lines(&diagnose(source, check)), [1]);
    }

    #[test]
    fn a_trailing_spread_argument_is_options_built_elsewhere() {
        for options in ["...options", "...args"] {
            let source = format!("store.subscribe(callback, {options});\n");
            assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0], "{options}");
        }
        assert_eq!(lines(&diagnose("store.subscribe(...args);\n", check)), [] as [usize; 0]);
    }

    #[test]
    fn quoted_id_keys_are_stable_ids() {
        for options in ["{\"id\": 'row-1'}", "{'id': 'row-1'}"] {
            let source = format!("store.subscribe(callback, {options});\n");
            assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0], "{options}");
        }
    }

    #[test]
    fn a_computed_id_key_stays_unknown() {
        assert_eq!(lines(&diagnose("store.subscribe(callback, {[key]: 'row-1'});\n", check)), [1]);
    }
}
