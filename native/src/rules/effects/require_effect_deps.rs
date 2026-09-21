//! H16: a prop or a piece of state read by an effect but missing from its dependencies.
//!
//! The effect then runs once with the first value and never again: the component re-renders with a
//! new prop while the effect keeps holding the old connection. It is the `exhaustive-deps` class of
//! bug without the hook, and it stays quiet because running once is also a legitimate intent.
//!
//! Deliberately conservative: only `this.props.x` and `this.state.x` are considered. A store read is
//! not a dependency — the component subscribes to it — and anything else would produce noise rather
//! than findings. A dependency covers every read below it, so `[this.props.user]` satisfies a read of
//! `this.props.user.name`. See docs/hazards.md, H16.
//!
//! Its own walk: a chain is reported once from its outermost expression, which a top-down visit gets
//! for free by stopping descent the moment a reactive-rooted member expression is found — its
//! object's inner layers would otherwise be visited (and reported) again.

use oxc_ast::ast::{Argument, CallExpression, MemberExpression, Program};
use oxc_ast_visit::{walk, Visit};
use oxc_span::{GetSpan, Span};

use crate::rules::report;
use crate::rules::support::chain::{chain_root, Base};
use crate::rules::support::names::member_call_name;
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/require-effect-deps";

/// Only these two carry per-render values; a store is subscribed to, not depended on.
const REACTIVE_ROOTS: [&str; 2] = ["props", "state"];

struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
    /// The dependency array's source text, one entry per element, while inside an effect body.
    deps: Option<Vec<String>>,
}

impl<'s> Check<'s> {
    fn text(&self, span: Span) -> String {
        self.source.text[span.start as usize..span.end as usize].to_string()
    }
}

impl<'a, 's> Visit<'a> for Check<'s> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if member_call_name(&call.callee) != Some("useEffect") {
            walk::walk_call_expression(self, call);

            return;
        }

        let deps: Vec<String> = match call.arguments.get(2) {
            Some(Argument::ArrayExpression(array)) => array
                .elements
                .iter()
                .filter_map(|element| element.as_expression())
                .map(|expression| self.text(expression.span()))
                .collect(),
            _ => Vec::new(),
        };

        let outer = self.deps.replace(deps);

        // Bodies whose reads a rule can actually see: `this.useEffect(this.props.carburetor.loadData,
        // 'load', [])` passes a reference instead of an inline function, and what that function reads
        // is in another file. Reporting the reference itself would fire on a pattern this library
        // recommends, so a non-inline body is left alone — reached simply by not descending into it.
        // A concise arrow (`() => connect(this.props.url)`) has no block to walk, so both forms go
        // through the generic body walker rather than only the block-statement case.
        match call.arguments.first() {
            Some(Argument::ArrowFunctionExpression(body)) => {
                walk::walk_arrow_function_body(self, &body.body);
            }
            Some(Argument::FunctionExpression(body)) => {
                if let Some(block) = &body.body {
                    self.visit_function_body(block);
                }
            }
            _ => {}
        }

        self.deps = outer;

        // The call's other arguments (the loader reference, the name, the dependency array itself)
        // are not walked: the array's own reads are the declaration, not a dependency, and the
        // effect body was already handled above under the right `self.deps`.
    }

    fn visit_member_expression(&mut self, expression: &MemberExpression<'a>) {
        let Some(deps) = self.deps.clone() else {
            walk::walk_member_expression(self, expression);

            return;
        };

        let MemberExpression::StaticMemberExpression(member) = expression else {
            walk::walk_member_expression(self, expression);

            return;
        };

        let root = chain_root(&member.object);
        let reactive =
            matches!(root.base, Base::This) && root.base_property.is_some_and(|name| REACTIVE_ROOTS.contains(&name));

        if !reactive {
            walk::walk_member_expression(self, expression);

            return;
        }

        // The outermost node in the chain is the first one a top-down visit reaches, so this is
        // it; the chain ends here and its inner layers are not visited again.
        let text = self.text(expression.span());
        let covered = deps
            .iter()
            .any(|dependency| &text == dependency || text.starts_with(&format!("{dependency}.")));

        if !covered {
            let message = format!(
                "{text} is read by this effect but is not in its dependencies, so the effect runs \
                 once with the first value and never again — it keeps whatever it set up for the old \
                 one. Add it to the dependency array, or keep the array empty deliberately and read \
                 the value some other way."
            );

            self.diagnostics.push(report(self.source, expression.span().start, RULE, message));
        }
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    let mut check = Check { source, diagnostics: Vec::new(), deps: None };

    check.visit_program(program);

    check.diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    #[test]
    fn a_prop_read_and_missing_from_deps_is_reported() {
        let source = "this.useEffect(() => {\n    load(this.props.id);\n}, 'load', []);\n";

        assert_eq!(lines(&diagnose(source, check)), [2]);
    }

    #[test]
    fn a_concise_arrow_body_is_analysable_too() {
        // Regression: a concise body (`() => expr`) has no block statement to walk, and the first
        // version of this rule only ever descended into the block-statement form — so a read like
        // this one, straight out of the conformance corpus, was silently never checked.
        let source = "this.useEffect(() => load(this.props.id), 'load', []);\n";

        assert_eq!(lines(&diagnose(source, check)), [1]);
    }

    #[test]
    fn a_prop_read_covered_by_deps_is_correct() {
        let source = "this.useEffect(() => {\n    load(this.props.id);\n}, 'load', [this.props.id]);\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_dependency_covers_every_read_below_it() {
        let source = "this.useEffect(() => {\n    load(this.props.user.name);\n}, 'load', [this.props.user]);\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_state_read_is_treated_the_same_as_a_prop() {
        let source = "this.useEffect(() => {\n    load(this.state.query);\n}, 'search', []);\n";

        assert_eq!(lines(&diagnose(source, check)), [2]);
    }

    #[test]
    fn a_store_read_is_not_a_dependency() {
        let source = "this.useEffect(() => {\n    load(store.getData());\n}, 'load', []);\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_chain_is_reported_once_from_its_outermost_expression() {
        let source = "this.useEffect(() => {\n    load(this.props.user.name.first);\n}, 'load', []);\n";

        assert_eq!(lines(&diagnose(source, check)), [2]);
    }

    #[test]
    fn a_non_inline_body_is_not_analysable() {
        let source = "this.useEffect(this.props.carburetor.loadData, 'load', []);\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn reads_in_the_dependency_array_itself_are_the_declaration() {
        let source = "this.useEffect(() => {\n    load();\n}, 'load', [this.props.id]);\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }
}
