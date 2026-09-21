//! H21: a handler built in render and passed to a child component.
//!
//! An arrow or a `.bind(this)` in a prop produces a new function on every render of the parent, so
//! the child's props always compare as changed, `shouldComponentUpdate` never bails out, and the
//! props gate — the thing that stops a parent render from cascading through the tree — quietly stops
//! working. Nothing breaks; the application just re-renders as much as it would without the library.
//!
//! `@bind` binds a method once per instance, which keeps the reference stable for the component's
//! lifetime. DOM elements are not reported: a fresh `onClick` on a `<button>` costs an attribute
//! update, not a subtree render. See docs/hazards.md, H21.

use oxc_ast::ast::{JSXAttribute, JSXAttributeValue, JSXExpression, Program};

use crate::rules::report;
use crate::rules::support::names::member_call_name;
use crate::rules::support::walk::{walk_rule, Context, Rule};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-handler-created-in-render";

/// Whether the prop's value is a function this render just built.
fn is_fresh_function(value: &Option<JSXAttributeValue<'_>>) -> bool {
    let Some(JSXAttributeValue::ExpressionContainer(container)) = value else {
        return false;
    };

    match &container.expression {
        JSXExpression::ArrowFunctionExpression(_) | JSXExpression::FunctionExpression(_) => true,
        JSXExpression::CallExpression(call) => member_call_name(&call.callee) == Some("bind"),
        _ => false,
    }
}

struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a, 's> Rule<'a> for Check<'s> {
    fn finish(self) -> Vec<Diagnostic> {
        self.diagnostics
    }

    fn jsx_attribute(&mut self, attribute: &JSXAttribute<'a>, context: &Context) {
        if !context.in_render || !is_fresh_function(&attribute.value) {
            return;
        }

        // A lowercase name is a DOM element; only a component re-renders a subtree.
        let Some(element) = context.jsx_element.as_deref() else {
            return;
        };

        if element.chars().next().is_none_or(|first| !first.is_uppercase()) {
            return;
        }

        let message = format!(
            "this prop is a new function on every render, so <{element}>'s props always compare as \
             changed and the props gate stops bailing out — the cascade the engine exists to prevent \
             comes back through the props. Declare the handler as a method with @bind and pass it by \
             reference."
        );

        self.diagnostics.push(report(self.source, attribute.span.start, RULE, message));
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

    /// Wraps a render body in a component, so each test reads as the code it is about.
    fn render(body: &str) -> String {
        format!("class Widget extends AntiHookComponent {{\n    render() {{\n{body}\n    }}\n}}\n")
    }

    #[test]
    fn an_inline_arrow_passed_to_a_component_is_reported() {
        let source = render("        return <Row onClick={() => this.handle()}/>;");

        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_bind_call_passed_to_a_component_is_reported() {
        let source = render("        return <Row onClick={this.handle.bind(this)}/>;");

        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_fresh_handler_on_a_dom_element_is_not_reported() {
        let source = render("        return <button onClick={() => this.handle()}/>;");

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_stable_reference_is_the_supported_form() {
        let source = render("        return <Row onClick={this.handle}/>;");

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_string_attribute_is_not_a_function() {
        let source = render("        return <Row label=\"x\"/>;");

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

}
