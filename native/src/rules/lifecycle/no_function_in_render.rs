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
use oxc_span::Span;

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

/// Records a span once, so one expression never yields the same diagnostic position twice.
fn push_once(out: &mut Vec<Span>, span: Span) {
    if !out.contains(&span) {
        out.push(span);
    }
}

/// Collects the spans of every function this expression creates, without descending into them.
///
/// A conditional or logical can build a function in either branch, so both arms are searched —
/// but the condition itself only selects, it never allocates a function.
fn fresh_functions(expression: &Expression<'_>, out: &mut Vec<Span>) {
    match expression {
        Expression::ArrowFunctionExpression(arrow) => push_once(out, arrow.span),
        Expression::FunctionExpression(function) => push_once(out, function.span),
        Expression::CallExpression(call) => {
            // A `.bind(this)` call is the function object it returns; the call's own span is where
            // a fix would land.
            if member_call_name(&call.callee) == Some("bind") {
                push_once(out, call.span);
            }
        }
        Expression::ParenthesizedExpression(expression) => {
            fresh_functions(&expression.expression, out)
        }
        Expression::TSAsExpression(expression) => fresh_functions(&expression.expression, out),
        Expression::TSSatisfiesExpression(expression) => {
            fresh_functions(&expression.expression, out)
        }
        Expression::TSTypeAssertion(expression) => fresh_functions(&expression.expression, out),
        Expression::TSNonNullExpression(expression) => fresh_functions(&expression.expression, out),
        Expression::TSInstantiationExpression(expression) => {
            fresh_functions(&expression.expression, out)
        }
        Expression::ConditionalExpression(expression) => {
            fresh_functions(&expression.consequent, out);
            fresh_functions(&expression.alternate, out);
        }
        Expression::LogicalExpression(expression) => {
            fresh_functions(&expression.left, out);
            fresh_functions(&expression.right, out);
        }
        _ => {}
    }
}

/// Collects the spans of every function the attribute's value creates.
fn fresh_attribute_functions(value: &Option<JSXAttributeValue<'_>>, out: &mut Vec<Span>) {
    let Some(JSXAttributeValue::ExpressionContainer(container)) = value else {
        return;
    };

    match &container.expression {
        JSXExpression::ArrowFunctionExpression(arrow) => push_once(out, arrow.span),
        JSXExpression::FunctionExpression(function) => push_once(out, function.span),
        JSXExpression::CallExpression(call) => {
            if member_call_name(&call.callee) == Some("bind") {
                push_once(out, call.span);
            }
        }
        JSXExpression::ParenthesizedExpression(expression) => {
            fresh_functions(&expression.expression, out)
        }
        JSXExpression::TSAsExpression(expression) => fresh_functions(&expression.expression, out),
        JSXExpression::TSSatisfiesExpression(expression) => {
            fresh_functions(&expression.expression, out)
        }
        JSXExpression::TSTypeAssertion(expression) => fresh_functions(&expression.expression, out),
        JSXExpression::TSNonNullExpression(expression) => {
            fresh_functions(&expression.expression, out)
        }
        JSXExpression::TSInstantiationExpression(expression) => {
            fresh_functions(&expression.expression, out)
        }
        JSXExpression::ConditionalExpression(expression) => {
            fresh_functions(&expression.consequent, out);
            fresh_functions(&expression.alternate, out);
        }
        JSXExpression::LogicalExpression(expression) => {
            fresh_functions(&expression.left, out);
            fresh_functions(&expression.right, out);
        }
        _ => {}
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
        if !context.in_render || context.jsx_component {
            return;
        }

        let mut spans = Vec::new();
        fresh_attribute_functions(&attribute.value, &mut spans);

        // The report lands on the function itself, where a method declaration would go.
        for span in spans {
            self.diagnostics
                .push(report(self.source, span.start, RULE, MESSAGE.to_string()));
        }
    }

    fn declarator(&mut self, declarator: &VariableDeclarator<'a>, context: &Context) {
        if !context.in_render {
            return;
        }

        let mut spans = Vec::new();
        if let Some(init) = &declarator.init {
            fresh_functions(init, &mut spans);
        }

        for span in spans {
            self.diagnostics
                .push(report(self.source, span.start, RULE, MESSAGE.to_string()));
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
    use crate::config::{Config, Severity};
    use crate::rules::allocations::require_method_for_closure;
    use crate::rules::allocations::require_module_function;
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

    fn run_rules_with(text: &str, customize: impl FnOnce(&mut Config)) -> Vec<Diagnostic> {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();

        assert!(
            parsed.diagnostics.is_empty(),
            "test source must parse: {:?}",
            parsed.diagnostics
        );

        let mut config = Config::default();
        customize(&mut config);

        crate::rules::run(
            &parsed.program,
            &crate::Source {
                path: Path::new("fixture.tsx"),
                text,
            },
            &config,
        )
    }

    fn run_rules(text: &str) -> Vec<Diagnostic> {
        run_rules_with(text, |_| {})
    }

    /// The rule set a full-registry run reports on one source line, sorted and exact.
    fn rules_on_line(diagnostics: &[Diagnostic], line: usize) -> Vec<&str> {
        let mut rules = diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.line == line)
            .map(|diagnostic| diagnostic.rule.as_str())
            .collect::<Vec<_>>();
        rules.sort_unstable();

        rules
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
        let cases = [
            // H29 claims the outer map arrow, which uses `this.pick`; H31 reports the inner arrow
            // itself, whose capture of the callback parameter blocks H29's rewrite of it.
            (
                "        return items.map((item) => <button onClick={() => this.pick(item.id)}/>);",
                vec![require_method_for_closure::RULE, RULE],
            ),
            // H29 wins here: the arrow needs nothing but `this`, and H31 yields to its advice.
            (
                "        return <button onClick={() => this.handle()}/>;",
                vec![require_method_for_closure::RULE],
            ),
            // A component prop is H21's finding alone.
            (
                "        return <Row onClick={() => this.handle()}/>;",
                vec![crate::rules::lifecycle::no_handler_created_in_render::RULE],
            ),
            // H30 wins: the arrow needs nothing from the class at all.
            (
                "        const h = () => handle();",
                vec![require_module_function::RULE],
            ),
        ];

        for (body, expected) in cases {
            let diagnostics = run_rules(&render(body));
            let mut expected = expected;
            expected.sort_unstable();

            assert_eq!(rules_on_line(&diagnostics, 3), expected, "{diagnostics:#?}");
        }

        // With H30 off there is nothing to yield to, and H31 reports the same local itself.
        let diagnostics = run_rules_with(&render("        const h = () => handle();"), |config| {
            config
                .override_rule(require_module_function::RULE, Severity::Off)
                .expect("registered rule");
        });
        assert_eq!(
            rules_on_line(&diagnostics, 3),
            vec![RULE],
            "{diagnostics:#?}"
        );
    }

    #[test]
    fn the_report_lands_on_the_arrow_not_the_attribute() {
        let body = "        return <button onClick={() => this.handle()}/>;";
        let source = render(body);

        // Through the full registry H29 claims the spot and H31 is deduplicated away.
        let diagnostics = run_rules(&source);
        assert_eq!(lines(&diagnostics), [3]);
        assert_eq!(
            rules_on_line(&diagnostics, 3),
            vec![require_method_for_closure::RULE],
            "{diagnostics:#?}"
        );

        // With H29 off, H31 reports at the arrow's own column, not the attribute's.
        let diagnostics = run_rules_with(&source, |config| {
            config
                .override_rule(require_method_for_closure::RULE, Severity::Off)
                .expect("registered rule");
        });
        assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
        assert_eq!(diagnostics[0].rule, RULE);
        assert_eq!(diagnostics[0].line, 3);
        // One-based column of the arrow's `(` within the render body's line.
        assert_eq!(diagnostics[0].column, body.find("() =>").unwrap() + 1);
    }

    #[test]
    fn a_map_callback_under_a_type_cast_still_marks_the_nested_handler() {
        let source = render(
            "        return items.map(((item) => <button onClick={() => pick(item.id)}/>) as (item: Item) => JSX.Element);",
        );
        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_conditional_arm_building_a_function_is_reported() {
        let source = render("        const x = cond ? () => act() : null;");
        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_logical_right_building_a_function_is_reported() {
        let source = render("        const y = cond && function () { act(); };");
        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_conditional_dom_attribute_building_a_function_is_reported() {
        let source = render("        return <button onClick={cond ? () => act() : undefined}/>;");
        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn both_conditional_arms_are_reported_separately() {
        let source = render("        const z = cond ? () => a() : () => b();");

        let diagnostics = diagnose(&source, check);
        assert_eq!(diagnostics.len(), 2, "{diagnostics:#?}");
        assert!(diagnostics.iter().all(|diagnostic| diagnostic.line == 3));
        assert_ne!(diagnostics[0].column, diagnostics[1].column);
    }
}
