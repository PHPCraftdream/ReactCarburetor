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

use oxc_ast::ast::{
    Expression, JSXAttribute, JSXAttributeValue, JSXExpression, Program,
};

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
        JSXExpression::ParenthesizedExpression(expression) => {
            is_fresh_expression(&expression.expression)
        }
        JSXExpression::TSAsExpression(expression) => is_fresh_expression(&expression.expression),
        JSXExpression::TSSatisfiesExpression(expression) => {
            is_fresh_expression(&expression.expression)
        }
        JSXExpression::TSTypeAssertion(expression) => {
            is_fresh_expression(&expression.expression)
        }
        JSXExpression::TSNonNullExpression(expression) => {
            is_fresh_expression(&expression.expression)
        }
        JSXExpression::TSInstantiationExpression(expression) => {
            is_fresh_expression(&expression.expression)
        }
        _ => false,
    }
}

fn is_fresh_expression(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => true,
        Expression::CallExpression(call) => member_call_name(&call.callee) == Some("bind"),
        Expression::ParenthesizedExpression(expression) => {
            is_fresh_expression(&expression.expression)
        }
        Expression::TSAsExpression(expression) => is_fresh_expression(&expression.expression),
        Expression::TSSatisfiesExpression(expression) => {
            is_fresh_expression(&expression.expression)
        }
        Expression::TSTypeAssertion(expression) => is_fresh_expression(&expression.expression),
        Expression::TSNonNullExpression(expression) => {
            is_fresh_expression(&expression.expression)
        }
        Expression::TSInstantiationExpression(expression) => {
            is_fresh_expression(&expression.expression)
        }
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

        if !context.jsx_component {
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
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;
    use std::path::Path;

    /// Wraps a render body in a component, so each test reads as the code it is about.
    fn render(body: &str) -> String {
        format!("class Widget extends AntiHookComponent {{\n    render() {{\n{body}\n    }}\n}}\n")
    }

    fn run_rules(text: &str) -> Vec<Diagnostic> {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();

        assert!(parsed.diagnostics.is_empty(), "test source must parse: {:?}", parsed.diagnostics);

        crate::rules::run(
            &parsed.program,
            &crate::Source {
                path: Path::new("fixture.tsx"),
                text,
            },
            &crate::config::Config::default(),
        )
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
    fn a_wrapped_fresh_handler_on_a_dom_element_is_not_reported() {
        let source = render("        return <button onClick={(() => this.handle()) as Handler}/>;");

        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn qualified_and_wrapped_component_props_report_once_through_the_full_registry() {
        for body in [
            "        return <UI.Button onClick={() => this.handle()}/>;",
            "        return <UI.Button onClick={(() => this.handle()) as Callback}/>;",
        ] {
            let diagnostics = run_rules(&render(body));

            assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
            assert_eq!(diagnostics[0].rule, RULE);
        }
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
