//! H12: a lifecycle override that does not call its base implementation.
//!
//! The base class does the real work in all four: `componentDidMount` commits subscriptions and runs
//! effects, `componentDidUpdate` re-runs them, `componentWillUnmount` releases both, and
//! `shouldComponentUpdate` is the props gate. Skipping `super` disables exactly one of those, so the
//! component renders correctly on mount and then never updates, or leaks every subscription it makes.
//! Nothing is raised at any point. Overriding `useEffects` / `unUseEffects` instead avoids the
//! question entirely. See docs/hazards.md, H12.
//!
//! Kept as its own walk: it needs to tell whether a `super.<name>()` call's result feeds a `return`
//! or a `const`, which oxc's parentless AST answers most simply by tracking, on the way down, that
//! the expression about to be visited is one whose value the method keeps.

use std::collections::{HashMap, HashSet};

use oxc_ast::ast::{
    CallExpression, Class, Expression, MethodDefinition, Program, ReturnStatement,
    VariableDeclarator,
};
use oxc_ast_visit::{walk, Visit};
use oxc_span::Span;

use crate::rules::report;
use crate::rules::support::bases::COMPONENT_BASES;
use crate::rules::support::names::{extends_any, property_key_name};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/require-super-in-lifecycle";

/// What the base class does in each of these is load-bearing, so skipping it breaks one thing.
const LIFECYCLE_NAMES: [&str; 4] = [
    "componentDidMount",
    "componentDidUpdate",
    "componentWillUnmount",
    "shouldComponentUpdate",
];

/// The gate has to return the base answer, not merely ask for it.
const ANSWERING_NAMES: [&str; 1] = ["shouldComponentUpdate"];

struct Override {
    offset: u32,
    name: &'static str,
}

struct Check<'s> {
    source: &'s Source<'s>,
    in_component: bool,
    /// The lifecycle override currently enclosing the walk: its span and name.
    current: Option<(Span, &'static str)>,
    /// The next expression visited is one whose value the enclosing method keeps.
    expecting_kept_value: bool,
    overrides: HashMap<Span, Override>,
    calls: HashSet<Span>,
    answers: HashSet<Span>,
}

impl<'a, 's> Visit<'a> for Check<'s> {
    fn visit_class(&mut self, class: &Class<'a>) {
        let outer = self.in_component;

        self.in_component = extends_any(class, &COMPONENT_BASES);

        walk::walk_class(self, class);

        self.in_component = outer;
    }

    fn visit_method_definition(&mut self, method: &MethodDefinition<'a>) {
        let name = property_key_name(&method.key);
        let lifecycle = self.in_component.then_some(name).flatten();
        let lifecycle = lifecycle.and_then(|name| LIFECYCLE_NAMES.iter().find(|known| **known == name));

        let outer = self.current.take();

        if let Some(name) = lifecycle {
            self.overrides.insert(method.span, Override { offset: method.span.start, name });
            self.current = Some((method.span, name));
        }

        walk::walk_method_definition(self, method);

        self.current = outer;
    }

    fn visit_return_statement(&mut self, statement: &ReturnStatement<'a>) {
        let outer = self.expecting_kept_value;

        self.expecting_kept_value = true;
        walk::walk_return_statement(self, statement);
        self.expecting_kept_value = outer;
    }

    fn visit_variable_declarator(&mut self, declarator: &VariableDeclarator<'a>) {
        let outer = self.expecting_kept_value;

        self.expecting_kept_value = true;
        walk::walk_variable_declarator(self, declarator);
        self.expecting_kept_value = outer;
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if let Expression::StaticMemberExpression(callee) = &call.callee {
            if matches!(callee.object, Expression::Super(_)) {
                if let Some((span, name)) = self.current {
                    // `super.somethingElse()` does not stand in for the method being overridden.
                    if callee.property.name == name {
                        self.calls.insert(span);

                        if self.expecting_kept_value {
                            self.answers.insert(span);
                        }
                    }
                }
            }
        }

        // Nothing inside a nested call keeps the outer statement's value.
        let outer = std::mem::take(&mut self.expecting_kept_value);
        walk::walk_call_expression(self, call);
        self.expecting_kept_value = outer;
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    let mut check = Check {
        source,
        in_component: false,
        current: None,
        expecting_kept_value: false,
        overrides: HashMap::new(),
        calls: HashSet::new(),
        answers: HashSet::new(),
    };

    check.visit_program(program);

    let mut diagnostics: Vec<Diagnostic> = Vec::new();

    for (member, over) in &check.overrides {
        if !check.calls.contains(member) {
            let message = format!(
                "{} is overridden without calling super.{}(), which is where the base class commits \
                 subscriptions, runs effects, releases them or gates a re-render. One of those \
                 silently stops working. Call super, or override useEffects/unUseEffects instead.",
                over.name, over.name
            );

            diagnostics.push(report(check.source, over.offset, RULE, message));

            continue;
        }

        if ANSWERING_NAMES.contains(&over.name) && !check.answers.contains(member) {
            let message = format!(
                "{} calls super but discards its answer, so the props gate no longer decides \
                 anything. Combine the two answers, for example `return \
                 super.shouldComponentUpdate(p, s) || mine`.",
                over.name
            );

            diagnostics.push(report(check.source, over.offset, RULE, message));
        }
    }

    diagnostics.sort_by_key(|diagnostic| (diagnostic.line, diagnostic.column));

    diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    #[test]
    fn an_override_that_skips_super_is_reported() {
        let source = "class Widget extends AntiHookComponent {\n    componentDidMount() {\n        \
                      this.load();\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [2]);
    }

    #[test]
    fn an_override_that_calls_super_is_correct() {
        let source = "class Widget extends AntiHookComponent {\n    componentDidMount() {\n        \
                      super.componentDidMount();\n        this.load();\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn should_component_update_that_discards_the_answer_is_reported() {
        let source = "class Widget extends AntiHookComponent {\n    shouldComponentUpdate(p, s) {\n        \
                      super.shouldComponentUpdate(p, s);\n        return this.mine;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [2]);
    }

    #[test]
    fn should_component_update_that_combines_the_answers_is_correct() {
        let source = "class Widget extends AntiHookComponent {\n    shouldComponentUpdate(p, s) {\n        \
                      return super.shouldComponentUpdate(p, s) || this.mine;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn binding_the_answer_to_a_variable_before_returning_is_correct() {
        let source = "class Widget extends AntiHookComponent {\n    shouldComponentUpdate(p, s) {\n        \
                      const base = super.shouldComponentUpdate(p, s);\n\n        return base || this.mine;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_call_to_a_different_super_method_does_not_stand_in() {
        let source = "class Widget extends AntiHookComponent {\n    componentDidMount() {\n        \
                      super.componentWillUnmount();\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [2]);
    }

    #[test]
    fn a_class_that_is_not_a_component_is_left_alone() {
        let source = "class Plain {\n    componentDidMount() {\n        this.load();\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_non_lifecycle_method_is_not_this_rules_business() {
        let source = "class Widget extends AntiHookComponent {\n    handleClick() {\n        this.load();\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }
}
