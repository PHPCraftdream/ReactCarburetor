//! H5: tracked data leaving the render that produced it.
//!
//! What `useCarburetor` returns is a proxy over the state as it is during that render. Read it after
//! the commit and nothing is tracked; read it after the branch it points at was replaced and it may
//! answer from data the store no longer holds. Both produce a plausible wrong value instead of an
//! error, which is why the escape is worth reporting even though many escapes are harmless: a
//! handler usually runs while its render is still the current one.
//!
//! Only a whole binding is tracked (`const data = this.useCarburetor(store)`). A destructured leaf is
//! usually a primitive and carries no proxy, so destructuring is left alone. See docs/hazards.md, H5.

use std::collections::HashMap;

use oxc_ast::ast::{
    AssignmentExpression, AssignmentTarget, Expression, IdentifierReference, Program,
    VariableDeclarator,
};
use oxc_span::Span;

use crate::rules::report;
use crate::rules::support::names::member_call_name;
use crate::rules::support::walk::{walk_rule, Context, Rule};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-escaping-tracked-data";

/// Whether the target of an assignment is a field of `this`, which outlives the render.
fn is_field_of_this(target: &AssignmentTarget<'_>) -> bool {
    match target {
        AssignmentTarget::StaticMemberExpression(member) => {
            matches!(member.object, Expression::ThisExpression(_))
        }
        AssignmentTarget::ComputedMemberExpression(member) => {
            matches!(member.object, Expression::ThisExpression(_))
        }
        _ => false,
    }
}

struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
    /// Name of a tracked binding -> the render function it was bound in.
    tracked: HashMap<String, Span>,
}

impl<'s> Check<'s> {
    /// Reports one escape, saying which way the data left the render.
    fn report(&mut self, offset: u32, detail: &str) {
        let message = format!(
            "tracked data {detail}. What useCarburetor returns is a proxy over the state during this \
             render: outside it nothing is tracked, and it may point at a branch the store has since \
             replaced. Read the values you need in render, or call getData() where you need them."
        );

        self.diagnostics.push(report(self.source, offset, RULE, message));
    }
}

impl<'a, 's> Rule<'a> for Check<'s> {
    fn finish(self) -> Vec<Diagnostic> {
        self.diagnostics
    }

    fn declarator(&mut self, declarator: &VariableDeclarator<'a>, context: &Context) {
        if !context.in_render {
            return;
        }

        let Some(Expression::CallExpression(call)) = &declarator.init else {
            return;
        };

        if member_call_name(&call.callee) != Some("useCarburetor") {
            return;
        }

        // Only a whole binding: a destructured leaf is usually a primitive and carries no proxy.
        if let Some(identifier) = declarator.id.get_binding_identifier() {
            self.tracked.insert(identifier.name.to_string(), context.function);
        }
    }

    fn assignment(&mut self, expression: &AssignmentExpression<'a>, _context: &Context) {
        let Expression::Identifier(right) = &expression.right else {
            return;
        };

        if !self.tracked.contains_key(right.name.as_str()) || !is_field_of_this(&expression.left) {
            return;
        }

        self.report(
            expression.span.start,
            "is stored on the component and outlives the render that read it",
        );
    }

    fn identifier(&mut self, identifier: &IdentifierReference<'a>, context: &Context) {
        let Some(owner) = self.tracked.get(identifier.name.as_str()).copied() else {
            return;
        };

        // A same-named local elsewhere in the class is a different variable.
        if !Context::within(identifier.span, owner) {
            return;
        }

        // A `map` callback still runs during the render, so it is not an escape.
        if context.in_render {
            return;
        }

        self.report(
            identifier.span.start,
            "is captured by a function that runs after this render",
        );
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    walk_rule(program, Check { source, diagnostics: Vec::new(), tracked: HashMap::new() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    /// Wraps a render body in a component, so each test reads as the code it is about.
    fn render(body: &str) -> String {
        format!("class Widget extends AntiHookComponent {{\n    render() {{\n{body}\n    }}\n}}\n")
    }

    #[test]
    fn data_captured_by_a_handler_is_reported() {
        let source = render(
            "        const data = this.useCarburetor(store);\n\n        \
             return <b onClick={() => store.rename(data.name)}/>;",
        );

        assert_eq!(lines(&diagnose(&source, check)), [5]);
    }

    #[test]
    fn data_stored_on_the_component_is_reported() {
        let source = render("        const data = this.useCarburetor(store);\n        this.cache = data;");

        assert_eq!(lines(&diagnose(&source, check)), [4]);
    }

    #[test]
    fn reading_it_in_render_is_the_point() {
        let source = render("        const data = this.useCarburetor(store);\n        return data.name;");

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_map_callback_still_runs_during_the_render() {
        let source = render(
            "        const data = this.useCarburetor(store);\n        \
             return data.ids.map((id) => data.items[id]);",
        );

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_destructured_leaf_is_left_alone() {
        let source = render(
            "        const {name} = this.useCarburetor(store);\n\n        \
             return <b onClick={() => store.rename(name)}/>;",
        );

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_read_outside_render_is_not_this_rules_tracked_binding() {
        let source = "class Widget extends AntiHookComponent {\n    save() {\n        \
                      const data = this.useCarburetor(store);\n\n        \
                      setTimeout(() => data.name);\n    }\n}\n";

        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }
}
