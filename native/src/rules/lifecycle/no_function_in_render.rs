//! H31: a function built in render for a DOM handler or a local.
//!
//! An arrow, a `function` expression or a `.bind(this)` created while a component renders is a
//! fresh object every render. For a `<button>` attribute that cost is only an attribute update —
//! but the pattern spreads: render bodies fill up with per-call helpers and per-item handlers, and
//! a class that allocates in render allocates everywhere. Declare a method with `@bind`, or move a
//! per-item handler into a child component that receives the id.
//!
//! Component props are H21's territory ([`crate::rules::lifecycle::no_handler_created_in_render`]);
//! this rule covers only what it does not: DOM-element attributes and locals in the render body.
//! See docs/hazards.md, H31.

use oxc_ast::ast::{
    Expression, Function, JSXAttribute, JSXAttributeValue, JSXExpression, Program,
    VariableDeclarator,
};

use crate::rules::report;
use crate::rules::support::names::member_call_name;
use crate::rules::support::walk::{walk_rule, Context, Rule};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-function-in-render";

/// The message this rule reports with.
const MESSAGE: &str = "this handler creates a new function on every render; declare a method with \
                       @bind, or move a per-item handler into a child component that receives the \
                       id.";

/// Whether the expression is a function this render just built.
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

/// Whether the attribute's value is a function this render just built.
fn is_fresh_function(value: &Option<JSXAttributeValue<'_>>) -> bool {
    let Some(JSXAttributeValue::ExpressionContainer(container)) = value else {
        return false;
    };

    match &container.expression {
        JSXExpression::ArrowFunctionExpression(_) | JSXExpression::FunctionExpression(_) => {
            true
        }
        JSXExpression::CallExpression(call) => member_call_name(&call.callee) == Some("bind"),
        JSXExpression::ParenthesizedExpression(expression) => {
            is_fresh_expression(&expression.expression)
        }
        JSXExpression::TSAsExpression(expression) => {
            is_fresh_expression(&expression.expression)
        }
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

struct Check<'s> {
    source: &'s Source<'s>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a, 's> Rule<'a> for Check<'s> {
    fn finish(self) -> Vec<Diagnostic> {
        self.diagnostics
    }

    fn jsx_attribute(&mut self, attribute: &JSXAttribute<'a>, context: &Context) {
        // Component props belong to H21; only a DOM element's attribute is this rule's business.
        if !context.in_render || context.jsx_component || !is_fresh_function(&attribute.value) {
            return;
        }

        self.diagnostics.push(report(
            self.source,
            attribute.span.start,
            RULE,
            MESSAGE.to_string(),
        ));
    }

    fn declarator(&mut self, declarator: &VariableDeclarator<'a>, context: &Context) {
        if !context.in_render {
            return;
        }

        if declarator
            .init
            .as_ref()
            .is_some_and(|init| is_fresh_expression(init))
        {
            self.diagnostics.push(report(
                self.source,
                declarator.span.start,
                RULE,
                MESSAGE.to_string(),
            ));
        }
    }

    fn function_declaration(&mut self, function: &Function<'a>, context: &Context) {
        // A declaration is a fresh object per render like any other; the walker calls this before
        // the function's own body is entered, so `in_render` still describes the render body.
        if !context.in_render {
            return;
        }

        self.diagnostics.push(report(
            self.source,
            function.span.start,
            RULE,
            MESSAGE.to_string(),
        ));
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    walk_rule(
        program,
        Check {
            source,
            diagnostics: Vec::new(),
        },
    )
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
        format!(
            "class Widget extends AntiHookComponent {{\n    render() {{\n{body}\n    }}\n}}\n"
        )
    }

    fn run_rules(text: &str) -> Vec<Diagnostic> {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();

        assert!(
            parsed.diagnostics.is_empty(),
            "test source must parse: {:?}",
            parsed.diagnostics
        );

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
    fn an_inline_arrow_on_a_dom_attribute_is_reported() {
        let source = render("        return <button onClick={() => this.handle()}/>;");
        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_bind_call_on_a_dom_attribute_is_reported() {
        let source = render("        return <button onClick={this.handle.bind(this)}/>;");
        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_ref_arrow_is_reported() {
        let source = render("        return <input ref={el => (this.field = el)}/>;");
        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_local_arrow_in_render_is_reported() {
        let source =
            render("        const handler = () => this.handle();\n        return handler();");
        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_local_bind_in_render_is_reported() {
        let source = render("        const h = this.m.bind(this);");
        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_local_function_expression_in_render_is_reported() {
        let source = render("        const f = function () { return 1; };");
        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_function_declaration_in_render_is_reported() {
        let source = render("        function inner() { return 1; }");
        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_per_item_handler_inside_a_map_is_reported_once() {
        let source = render(
            "        return items.map(item => <li onClick={() => this.select(item.id)}/>);",
        );

        // The map callback itself runs in place and is not reported; only the inner arrow is.
        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_map_callback_without_a_nested_handler_is_not_reported() {
        let source = render("        return items.map(item => <li key={item}/>);");
        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_stable_method_reference_is_not_reported() {
        let source = render("        return <button onClick={this.handle}/>;");
        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_fresh_arrow_in_a_component_prop_is_h21s_not_ours() {
        let source = render("        return <Row onClick={() => this.handle()}/>;");
        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn an_arrow_inside_a_use_effect_callback_is_not_reported() {
        let source = render("        useEffect(() => { const f = () => {}; }, []);");
        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn an_arrow_inside_a_non_render_method_is_not_reported() {
        let source = "\
class Widget extends AntiHookComponent {
    update(change: number) {
        const f = () => change;
        return f();
    }
}
";
        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn an_arrow_inside_the_constructor_is_not_reported() {
        let source = "\
class Widget extends AntiHookComponent {
    constructor() {
        super();
        const f = () => 1;
    }
}
";
        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn an_arrow_inside_a_nested_handler_is_not_reported_only_the_outer_local_is() {
        let source = render("        const outer = () => { const inner = () => 1; };");
        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_functional_component_is_not_reported() {
        let source = "function Row() {\n    return <li/>;\n}\n";
        assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_string_attribute_is_not_a_function() {
        let source = render("        return <button label=\"x\"/>;");
        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn dom_attributes_report_once_through_the_full_registry() {
        for body in [
            "        return <button onClick={() => this.handle()}/>; // H31 only",
            "        return <Row onClick={() => this.handle()}/>; // H21 only",
        ] {
            let diagnostics = run_rules(&render(body));
            let expected: &[&str] = if body.contains("H31") {
                &[RULE]
            } else {
                &[crate::rules::lifecycle::no_handler_created_in_render::RULE]
            };
            let rules = diagnostics
                .iter()
                .map(|diagnostic| diagnostic.rule.as_str())
                .filter(|rule| *rule == RULE || *rule == expected[0])
                .collect::<Vec<_>>();

            // Other rules may also fire on the fixture; this one must fire exactly where the
            // spec puts it and never double up with H21 on the same attribute.
            assert_eq!(rules, expected, "{diagnostics:#?}");
        }
    }
}
