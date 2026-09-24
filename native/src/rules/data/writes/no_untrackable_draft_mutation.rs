//! H10: an in-place change to a value the engine cannot track, reached through `draft`.
//!
//! Tracking stops at `Map`, `Set`, `Date` and class instances: the proxy hands out the real object,
//! so the mutation happens behind its back. No update is lost over it — reaching for such a value
//! through `draft` is recorded as writing the path it came from — but the granularity stops there:
//! the whole value is invalidated whatever changed inside it, and the same mutation made through
//! `this.data` invalidates the entire store. Replacing the value keeps the usual precision, and
//! plain data keeps all of it. See docs/hazards.md, H10.

use oxc_ast::ast::{CallExpression, Expression, Program};

use crate::rules::report;
use crate::rules::support::bases::MUTATING_METHODS;
use crate::rules::support::chain::chain_root;
use crate::rules::support::names::member_call_name;
use crate::rules::support::walk::{walk_rule, Context, Rule};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-untrackable-draft-mutation";

struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a, 's> Rule<'a> for Check<'s> {
    fn finish(self) -> Vec<Diagnostic> {
        self.diagnostics
    }

    fn call(&mut self, call: &CallExpression<'a>, context: &Context) {
        if !context.in_carburetor {
            return;
        }

        let Some(method) = member_call_name(&call.callee) else {
            return;
        };

        if !MUTATING_METHODS.contains(&method) {
            return;
        }

        let Expression::StaticMemberExpression(callee) = &call.callee else {
            return;
        };

        let root = chain_root(&callee.object);

        // Either `this.draft.x.set(...)` or the draft an `update(draft => ...)` callback named.
        let through_draft = root.is_this_property("draft");
        let through_update = root.identifier().is_some()
            && root.identifier() == context.update_draft.as_deref();

        if !through_draft && !through_update {
            return;
        }

        let message = format!(
            "{method}() changes a value the tracking proxies cannot wrap, so the change itself is \
             invisible and the whole value is invalidated instead of the part that changed. Replace \
             the value (draft.x = next) or keep plain objects and arrays in the store."
        );

        self.diagnostics.push(report(self.source, call.span.start, RULE, message));
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    walk_rule(program, Check { source, diagnostics: Vec::new() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    /// Wraps a class body in a store, so each test reads as the code it is about.
    fn store(body: &str) -> String {
        format!("class Store extends Carburetor {{\n{body}\n}}\n")
    }

    #[test]
    fn a_map_write_through_draft_is_reported() {
        let source = store("    put(k, v) {\n        this.draft.index.set(k, v);\n    }");

        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_map_write_through_an_update_draft_is_reported() {
        let source = store(
            "    put(k, v) {\n        this.update((draft) => {\n            \
             draft.index.set(k, v);\n        });\n    }",
        );

        assert_eq!(lines(&diagnose(&source, check)), [4]);
    }

    #[test]
    fn a_date_mutation_is_reported() {
        let source = store("    touch() {\n        this.draft.updatedAt.setTime(0);\n    }");

        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn replacing_the_value_is_the_supported_form() {
        let source = store("    put(k, v) {\n        this.draft.index = new Map([[k, v]]);\n    }");

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn the_same_call_on_an_unrelated_object_is_left_alone() {
        let source = store("    put(k, v) {\n        this.cache.set(k, v);\n    }");

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_differently_named_update_parameter_is_still_the_draft() {
        let source = store(
            "    put(k, v) {\n        this.update((d) => {\n            d.index.add(v);\n        });\n    }",
        );

        assert_eq!(lines(&diagnose(&source, check)), [4]);
    }

    #[test]
    fn outside_a_store_the_rule_says_nothing() {
        let source = "class Plain {\n    put(k, v) {\n        this.draft.index.set(k, v);\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }
}
