//! H20: a subscription whose id is thrown away.
//!
//! The carburetor holds the callback, and the callback holds everything it closed over, for the
//! lifetime of the store. Nothing fails: memory grows and the callback keeps firing after the thing
//! it served is gone. `watch(select, onChange)` returns a disposer instead, which makes the cleanup
//! impossible to forget; components need neither, since `useCarburetor` subscribes and
//! `componentWillUnmount` releases.
//!
//! A watch whose disposer is thrown away (`store.watch(select, onChange);` or
//! `computed.watch(onChange);` as a statement) leaks the same way. A store watching itself
//! (`this.watch(...)`) lives as long as the store and is not reported, nor are calls whose
//! arguments cannot be callbacks (`fs.watch('dir')`).
//!
//! A subscription made with an explicit `{id}` is not reported: the caller kept a handle and can
//! release or replace it by that id, which is exactly how the engine subscribes components and
//! computed values. See docs/hazards.md, H20.

use oxc_ast::ast::{CallExpression, Expression, ObjectPropertyKind, Program};
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::{Scoping, Semantic};
use oxc_span::{GetSpan, Span};

use crate::rules::report;
use crate::rules::support::bases::Bases;
use crate::rules::support::closures::build_semantic;
use crate::rules::support::names::{
    called_on_this, member_call_name, property_key_name, unwrap_expression,
};
use crate::rules::support::walk::test_scope::retain_outside_tests;
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/require-subscription-disposal";

const MESSAGE: &str =
    "this subscription's id is discarded, so it can never be released: the store \
    keeps the callback, and everything it closed over, for the lifetime of the process. Use \
    watch(select, onChange), which returns a disposer, or keep the id and unsubscribe.";

const WATCH_MESSAGE: &str = "this watch's disposer is discarded, so it can never be stopped: the     store keeps the callback, and everything it closed over, for the lifetime of the process. Keep     the disposer and call it when the owner is done, or use useStoreEffect in a component.";

/// Whether a call is a store's `watch(select, onChange)` or a computed's `watch(onChange)` on
/// something other than `this`: literal arguments (`fs.watch('dir')`) are another API.
fn is_foreign_watch(call: &CallExpression<'_>) -> bool {
    member_call_name(&call.callee) == Some("watch")
        && !called_on_this(&call.callee)
        && matches!(call.arguments.len(), 1 | 2)
        && call.arguments.iter().all(|argument| {
            argument.as_expression().is_some_and(|expression| {
                !matches!(
                    unwrap_expression(expression),
                    Expression::StringLiteral(_)
                        | Expression::TemplateLiteral(_)
                        | Expression::NumericLiteral(_)
                        | Expression::ObjectExpression(_)
                )
            })
        })
}

const STORE_EFFECT_MESSAGE: &str = "this storeEffect's disposer is discarded, so the effect can \
    never be stopped: the store keeps it, and everything it closed over, for the lifetime of the \
    process, and its last cleanup never runs. Keep the disposer and call it when the owner is \
    done, or use useStoreEffect in a component.";

/// Whether a call is `storeEffect(store, select, effect)` or `storeEffect(computed, effect)`,
/// called by name or through a namespace import (`Engine.storeEffect(...)`).
fn is_store_effect(call: &CallExpression<'_>) -> bool {
    let named = match unwrap_expression(&call.callee) {
        Expression::Identifier(identifier) => identifier.name == "storeEffect",
        callee => member_call_name(callee) == Some("storeEffect") && !called_on_this(callee),
    };

    named && matches!(call.arguments.len(), 2 | 3)
}

/// Whether the expression is the literal `null`, `void 0`, or an unresolved (global) `undefined`;
/// a resolved shadowing binding named `undefined` is unknown options, not nullish.
fn is_explicit_nullish(expression: &Expression<'_>, scoping: &Scoping) -> bool {
    match expression {
        Expression::NullLiteral(_) => true,
        Expression::UnaryExpression(unary) => unary.operator.is_void(),
        Expression::Identifier(identifier) => {
            identifier.name == "undefined"
                && identifier
                    .reference_id
                    .get()
                    .and_then(|id| scoping.get_reference(id).symbol_id())
                    .is_none()
        }
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
        ObjectPropertyKind::ObjectProperty(property) => {
            property_key_name(&property.key) == Some("id")
        }
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
        if self.discarded_expression == Some(call.span) {
            let message = if member_call_name(&call.callee) == Some("subscribe")
                && !has_stable_id(call, self.semantic.scoping())
            {
                Some(MESSAGE)
            } else if is_foreign_watch(call) {
                Some(WATCH_MESSAGE)
            } else if is_store_effect(call) {
                Some(STORE_EFFECT_MESSAGE)
            } else {
                None
            };

            if let Some(message) = message {
                self.diagnostics.push(report(
                    self.source,
                    call.span.start,
                    RULE,
                    message.to_string(),
                ));
            }
        }

        walk::walk_call_expression(self, call);
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source, _bases: &Bases) -> Vec<Diagnostic> {
    let semantic = build_semantic(program);
    check_with_semantic(program, source, &semantic, _bases)
}

pub(in crate::rules) fn check_with_semantic<'a>(
    program: &Program<'a>,
    source: &Source<'_>,
    semantic: &'a Semantic<'a>,
    _bases: &Bases,
) -> Vec<Diagnostic> {
    let mut check = Check {
        source,
        semantic,
        diagnostics: Vec::new(),
        discarded_expression: None,
    };

    check.visit_program(program);

    // A subscription made inside a test lives as long as that test, not the process.
    let mut diagnostics = check.diagnostics;
    retain_outside_tests(&mut diagnostics, RULE, program, semantic, source);

    diagnostics
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
    fn a_subscription_inside_a_test_is_not_reported() {
        let source = "it('wakes', () => {
    store.subscribe(() => { seen++; });
});
";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn the_same_subscription_outside_a_test_is_still_reported() {
        let source = "setup(() => {
    store.subscribe(() => { seen++; });
});
";

        assert_eq!(lines(&diagnose(source, check)), [2]);
    }

    #[test]
    fn a_subscription_with_a_stable_id_is_correct() {
        let source = "store.subscribe(callback, {id: 'row-1'});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn subscription_nested_in_callback_statement_is_not_discarded() {
        let source =
            "outer(() => {\n    const id = store.subscribe(callback);\n    use(id);\n});\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn round_five_kept_return_with_undefined_and_null_options_is_not_discarded() {
        for value in ["undefined", "null"] {
            let source = format!("const id = store.subscribe(callback, {value});\n");
            assert_eq!(
                lines(&diagnose(&source, check)),
                [] as [usize; 0],
                "{value}"
            );
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
        assert_eq!(
            lines(&diagnose("store.subscribe(callback, void 0);\n", check)),
            [1]
        );
    }

    #[test]
    fn discarded_subscription_with_unknown_options_or_spread_is_not_reported() {
        for options in ["options", "{...options}"] {
            let source = format!("store.subscribe(callback, {options});\n");
            assert_eq!(
                lines(&diagnose(&source, check)),
                [] as [usize; 0],
                "{options}"
            );
        }
    }

    #[test]
    fn options_built_elsewhere_may_carry_the_callers_id() {
        for options in ["options", "buildOptions(id)", "{...options}"] {
            let source = format!(
                "store.subscribe(callback, {options});
"
            );
            assert_eq!(
                lines(&diagnose(&source, check)),
                [] as [usize; 0],
                "{options}"
            );
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
        assert_eq!(
            lines(&diagnose("const id = store.subscribe(callback);\n", check)),
            [] as [usize; 0]
        );
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
            assert_eq!(
                lines(&diagnose(&source, check)),
                [] as [usize; 0],
                "{options}"
            );
        }
        assert_eq!(
            lines(&diagnose("store.subscribe(...args);\n", check)),
            [] as [usize; 0]
        );
    }

    #[test]
    fn quoted_id_keys_are_stable_ids() {
        for options in ["{\"id\": 'row-1'}", "{'id': 'row-1'}"] {
            let source = format!("store.subscribe(callback, {options});\n");
            assert_eq!(
                lines(&diagnose(&source, check)),
                [] as [usize; 0],
                "{options}"
            );
        }
    }

    #[test]
    fn a_computed_id_key_stays_unknown() {
        assert_eq!(
            lines(&diagnose(
                "store.subscribe(callback, {[key]: 'row-1'});\n",
                check
            )),
            [1]
        );
    }

    #[test]
    fn a_discarded_watch_disposer_is_reported() {
        let source = concat!(
            "store.watch(selectTitle, onTitle);
",
            "total.watch((value) => show(value));
",
            "const stop = store.watch(selectTitle, onTitle);
",
            "this.watch(selectTitle, onTitle);
",
            "fs.watch('dir', {recursive: true});
",
            "fs.watch(`dir`);
",
        );

        assert_eq!(lines(&diagnose(source, check)), [1, 2]);
    }

    #[test]
    fn a_discarded_store_effect_disposer_is_reported() {
        let source = concat!(
            "storeEffect(store, selectTitle, showTitle);\n",
            "Engine.storeEffect(total, showTotal);\n",
            "const stop = storeEffect(store, selectTitle, showTitle);\n",
            "export const dispose = storeEffect(total, showTotal);\n",
            "this.storeEffect(store, selectTitle, showTitle);\n",
            "storeEffect(onlyOne);\n",
        );

        assert_eq!(lines(&diagnose(source, check)), [1, 2]);
        assert!(diagnose(source, check)[0]
            .message
            .contains("storeEffect's disposer"));
    }

    #[test]
    fn a_discarded_store_effect_inside_a_test_is_not_reported() {
        let source =
            "it('follows', () => {\n    storeEffect(store, selectTitle, showTitle);\n});\n";

        assert!(diagnose(source, check).is_empty());
    }

    #[test]
    fn a_discarded_watch_inside_a_test_is_not_reported() {
        let source = "test('x', () => {
    store.watch(selectTitle, onTitle);
});
";

        assert!(diagnose(source, check).is_empty());
    }
}
