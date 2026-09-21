//! H22: a method of a component passed around without `@bind`.
//!
//! A prototype method handed over as a value loses its receiver, so `this` is undefined when the
//! handler fires. That throws rather than failing silently — but only once someone clicks, and the
//! two fixes people reach for, `.bind(this)` in render and an inline arrow, defeat the props gate
//! instead (H21). So the rule points at `@bind`, which binds once per instance and keeps the method
//! on the prototype. See docs/hazards.md, H22.
//!
//! This rule keeps its own walk: it needs to tell `this.x()` and `this.x = v` (which keep or
//! declare the receiver) apart from `this.x` handed over as a value, and oxc's AST carries no parent
//! pointer to ask a node "what is your parent doing with you". The walk marks the excluded spans on
//! the way in — a call's callee, an assignment's target — before visiting them.

use std::collections::{HashMap, HashSet};

use oxc_ast::ast::{
    AssignmentExpression, AssignmentTarget, CallExpression, Class, Decorator, Expression,
    MemberExpression, MethodDefinition, Program,
};
use oxc_ast_visit::{walk, Visit};
use oxc_span::{GetSpan, Span};

use crate::rules::report;
use crate::rules::support::bases::COMPONENT_BASES;
use crate::rules::support::names::{extends_any, property_key_name};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/require-bind-for-passed-method";

/// What is known about one method, keyed by `(class span, method name)`.
#[derive(Default)]
struct MethodFacts {
    bound: bool,
    uses_this: bool,
}

/// Whether the member carries `@bind`.
fn is_bound(decorators: &[Decorator<'_>]) -> bool {
    decorators.iter().any(|decorator| {
        matches!(&decorator.expression, Expression::Identifier(identifier) if identifier.name == "bind")
    })
}

struct Check<'s> {
    source: &'s Source<'s>,
    /// The classes currently enclosing the walk that are components, span and name-of-method-stack.
    components: Vec<Span>,
    /// The method currently enclosing the walk, name only — `None` outside any method.
    methods_stack: Vec<String>,
    facts: HashMap<(Span, String), MethodFacts>,
    /// `this.x` reference sites that are candidates, resolved once the whole file is known.
    references: Vec<(u32, Span, String)>,
    /// Spans excluded from being "passed as a value": a call's callee, an assignment's target.
    excluded: HashSet<Span>,
}

impl<'s> Check<'s> {
    fn key(&self, name: &str) -> Option<(Span, String)> {
        self.components.last().map(|span| (*span, name.to_string()))
    }

    fn record_call_or_assignment_target(&mut self, expression: &Expression<'_>) {
        if let Expression::StaticMemberExpression(member) = expression {
            self.excluded.insert(member.span);
        }
    }
}

impl<'a, 's> Visit<'a> for Check<'s> {
    fn visit_class(&mut self, class: &Class<'a>) {
        let is_component = extends_any(class, &COMPONENT_BASES);

        if is_component {
            self.components.push(class.span);
        }

        walk::walk_class(self, class);

        if is_component {
            self.components.pop();
        }
    }

    fn visit_method_definition(&mut self, method: &MethodDefinition<'a>) {
        if let Some(name) = property_key_name(&method.key) {
            if let Some(key) = self.key(name) {
                self.facts.entry(key).or_default().bound |= is_bound(&method.decorators);
            }

            self.methods_stack.push(name.to_string());
            walk::walk_method_definition(self, method);
            self.methods_stack.pop();

            return;
        }

        walk::walk_method_definition(self, method);
    }

    fn visit_this_expression(&mut self, _it: &oxc_ast::ast::ThisExpression) {
        if let Some(method) = self.methods_stack.last().cloned() {
            if let Some(key) = self.key(&method) {
                self.facts.entry(key).or_default().uses_this = true;
            }
        }
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        self.record_call_or_assignment_target(&call.callee);

        walk::walk_call_expression(self, call);
    }

    fn visit_assignment_expression(&mut self, expression: &AssignmentExpression<'a>) {
        // `this.x = ...` declares the field; only a `StaticMemberExpression` target needs marking,
        // an identifier target cannot be `this.x` in the first place.
        if let AssignmentTarget::StaticMemberExpression(member) = &expression.left {
            self.excluded.insert(member.span);
        }

        walk::walk_assignment_expression(self, expression);
    }

    fn visit_member_expression(&mut self, expression: &MemberExpression<'a>) {
        // `this.x.y` reaches through `this.x` the same way `this.x = ...` declares it: neither
        // hands `this.x` over as a value. Marking the object here, before descending, is what
        // keeps `this.onPress.bind(this)` from being read as "onPress passed as a value" — it is
        // the call that is, and that call is excluded separately, in visit_call_expression.
        if let MemberExpression::StaticMemberExpression(outer) = expression {
            self.record_call_or_assignment_target(&outer.object);
        }

        if let MemberExpression::StaticMemberExpression(member) = expression {
            if matches!(member.object, Expression::ThisExpression(_))
                && !self.excluded.contains(&member.span)
                && !self.components.is_empty()
            {
                self.references.push((
                    expression.span().start,
                    *self.components.last().unwrap(),
                    member.property.name.to_string(),
                ));
            }
        }

        walk::walk_member_expression(self, expression);
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    let mut check = Check {
        source,
        components: Vec::new(),
        methods_stack: Vec::new(),
        facts: HashMap::new(),
        references: Vec::new(),
        excluded: HashSet::new(),
    };

    check.visit_program(program);

    check
        .references
        .iter()
        .filter_map(|(offset, class_span, name)| {
            let facts = check.facts.get(&(*class_span, name.clone()))?;

            if facts.bound || !facts.uses_this {
                return None;
            }

            let message = format!(
                "this.{name} is a prototype method passed as a value, so `this` will be undefined \
                 when it runs. Decorate it with @bind, which binds once per instance — binding here \
                 instead would build a new function every render and defeat the props gate."
            );

            Some(report(check.source, *offset, RULE, message))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    #[test]
    fn an_unbound_method_passed_as_a_value_is_reported() {
        let source = "class Widget extends AntiHookComponent {\n    handleClick() {\n        \
                      this.doThing();\n    }\n\n    render() {\n        \
                      return <Row onClick={this.handleClick}/>;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [7]);
    }

    #[test]
    fn a_bound_method_passed_as_a_value_is_correct() {
        let source = "class Widget extends AntiHookComponent {\n    @bind\n    handleClick() {\n        \
                      this.doThing();\n    }\n\n    render() {\n        \
                      return <Row onClick={this.handleClick}/>;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn calling_the_method_keeps_its_receiver() {
        let source = "class Widget extends AntiHookComponent {\n    handleClick() {\n        \
                      this.doThing();\n    }\n\n    render() {\n        \
                      this.handleClick();\n        return null;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_method_that_never_reads_this_needs_no_receiver() {
        let source = "class Widget extends AntiHookComponent {\n    handleClick() {\n        \
                      console.log('clicked');\n    }\n\n    render() {\n        \
                      return <Row onClick={this.handleClick}/>;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn the_assignment_target_itself_is_excluded_but_its_right_side_is_still_a_reference() {
        // `this.x = ...` declares the LEFT occurrence; the RIGHT one still hands the unbound method
        // over as a value, and is exactly the same hazard as passing it anywhere else.
        let source = "class Widget extends AntiHookComponent {\n    handleClick() {\n        \
                      this.doThing();\n    }\n\n    setup() {\n        \
                      this.handleClick = this.handleClick;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [7]);
    }

    #[test]
    fn a_call_bound_at_the_call_site_reaches_through_rather_than_passing_the_reference() {
        // Regression: `this.onPress.bind(this)` is the CALL that gets excluded, not `this.onPress`
        // itself — `this.onPress` sits as the object of the `.bind` access, reaching through it the
        // same way `this.x.y` does. Missing that exemption reported this pattern as unbound even
        // though it never leaves this expression as a bare reference. Dogfooding on this
        // repository's own tests found this: __tests__/Engine/Component/bind.test.tsx deliberately
        // uses `.bind(this)` in render to demonstrate the props-gate hazard `no-handler-created-in-
        // render` warns about, and that file must not also trip this rule for the same line.
        let source = "class Widget extends AntiHookComponent {\n    onPress() {\n        \
                      this.doThing();\n    }\n\n    render() {\n        \
                      return <Row onClick={this.onPress.bind(this)}/>;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_class_that_is_not_a_component_is_left_alone() {
        let source = "class Plain {\n    handleClick() {\n        this.doThing();\n    }\n\n    \
                      use() {\n        return this.handleClick;\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }
}
