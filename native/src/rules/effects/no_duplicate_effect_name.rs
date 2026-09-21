//! H15: two effects registered under the same name in one component.
//!
//! The name is the effect's identity: its dependency array and its cleanup are stored under it. A
//! second registration overwrites the first one's record, so the first effect's cleanup is lost and
//! the deps comparison starts answering for the second. The symptom is a listener that is never
//! removed, which surfaces much later as a leak. See docs/hazards.md, H15.

use std::collections::HashSet;

use oxc_ast::ast::{CallExpression, Expression, Program};

use crate::rules::report;
use crate::rules::support::names::member_call_name;
use crate::rules::support::walk::{walk_rule, Context, Rule};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-duplicate-effect-name";

struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
    /// `(class span, effect name)` already seen.
    seen: HashSet<(u32, u32, String)>,
}

impl<'a, 's> Rule<'a> for Check<'s> {
    fn finish(self) -> Vec<Diagnostic> {
        self.diagnostics
    }

    fn call(&mut self, call: &CallExpression<'a>, context: &Context) {
        if member_call_name(&call.callee) != Some("useEffect") {
            return;
        }

        let Some(Expression::StringLiteral(name)) = call.arguments.get(1).and_then(|a| a.as_expression())
        else {
            return;
        };

        // Detection is by whatever class this effect sits in, not necessarily a component: the JS
        // rule keys on `findEnclosingClassExtending(node, componentBases)`, so a plain class using
        // `useEffect` outside a component context is not this rule's business — `in_component`
        // already carries that.
        if !context.in_component {
            return;
        }

        let Some(class_span) = context.class_span else {
            return;
        };

        let key = (class_span.start, class_span.end, name.value.to_string());

        if self.seen.insert(key) {
            return;
        }

        let message = format!(
            "two effects in this component are registered as \"{}\". The name is the effect's \
             identity, so the second registration overwrites the first: its cleanup is lost and \
             never runs. Give each effect its own name.",
            name.value
        );

        self.diagnostics.push(report(self.source, name.span.start, RULE, message));
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    walk_rule(program, Check { source, diagnostics: Vec::new(), seen: HashSet::new() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    /// Wraps a method body in a component, so each test reads as the code it is about.
    fn component(body: &str) -> String {
        format!("class Widget extends AntiHookComponent {{\n    useEffects() {{\n{body}\n    }}\n}}\n")
    }

    #[test]
    fn two_effects_with_the_same_name_are_reported() {
        let source = component(
            "        this.useEffect(this.load, 'load', []);\n        this.useEffect(this.retry, 'load', []);",
        );

        assert_eq!(lines(&diagnose(&source, check)), [4]);
    }

    #[test]
    fn two_effects_with_different_names_are_correct() {
        let source = component(
            "        this.useEffect(this.load, 'load', []);\n        this.useEffect(this.retry, 'retry', []);",
        );

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_name_built_at_runtime_cannot_be_compared() {
        let source = component("        this.useEffect(this.load, name, []);\n        this.useEffect(this.retry, name, []);");

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn the_same_name_in_two_different_components_is_not_a_duplicate() {
        let source = "class A extends AntiHookComponent {\n    useEffects() {\n        this.useEffect(this.load, 'load', []);\n    }\n}\n\nclass B extends AntiHookComponent {\n    useEffects() {\n        this.useEffect(this.load, 'load', []);\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }
}
