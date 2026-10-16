//! H31: a function built in render for a DOM handler, a local, or an array callback.
//!
//! An arrow, a `function` expression or a `.bind(this)` created while a component renders is a
//! fresh object every render — including one handed to `map`, `filter` and the like, which runs
//! while the render evaluates. Declare a method with `@bind` and pass it by reference, or move a
//! per-item case into a child component that receives the id.
//!
//! Component props are H21's territory ([`crate::rules::lifecycle::no_handler_created_in_render`]);
//! this rule covers only what it does not: DOM-element attributes and locals in the render body.
//! See docs/hazards.md, H31.

use oxc_ast::ast::{CallExpression, Expression, Function, JSXAttribute, Program, VariableDeclarator};
use oxc_semantic::Semantic;
use oxc_span::Span;

use crate::rules::report;
use crate::rules::support::bases::SYNCHRONOUS_CALLBACKS;
use crate::rules::support::closures::{build_semantic, CaptureIndex};
use crate::rules::support::names::{member_call_name, unwrap_expression};
use crate::rules::support::walk::{walk_rule, Context, RenderKind, Rule};
use crate::rules::support::walk::functions::{fresh_attribute_functions, fresh_functions};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-function-in-render";

/// The message this rule reports with.
const MESSAGE: &str = "this function creates a new function on every render; pass a bound method \
                       like ids.map(this.renderItem) — declare it with @bind.";

/// The span of the function a synchronous callback argument creates, if it creates one.
fn fresh_callback(expression: &Expression<'_>) -> Option<Span> {
    match expression {
        Expression::ArrowFunctionExpression(arrow) => Some(arrow.span),
        Expression::FunctionExpression(function) => Some(function.span),
        _ => None,
    }
}

struct Check<'s, 'a> {
    source: &'s Source<'s>,
    semantic: &'s Semantic<'a>,
    index: CaptureIndex<'a>,
    diagnostics: Vec<Diagnostic>,
}

impl Check<'_, '_> {
    fn message(&self, span: Span, context: &Context) -> String {
        if context.render_kind == Some(RenderKind::Function)
            && self.index.captures_non_module(span, self.semantic)
        {
            "this function captures values from the render; move it into a child AntiHookComponent that receives the needed props and passes a @bind method, or convert this component to AntiHookComponent.".to_string()
        } else if context.render_kind == Some(RenderKind::Function) {
            "this function captures no render values; move it to module scope.".to_string()
        } else {
            MESSAGE.to_string()
        }
    }
}

impl<'a, 's> Rule<'a> for Check<'s, 'a> {
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
                .push(report(self.source, span.start, RULE, self.message(span, context)));
        }
    }

    fn call(&mut self, call: &CallExpression<'a>, context: &Context) {
        // A callback of `map`, `filter` and the like runs while the render evaluates, so it is a
        // fresh function like any other; one passed by reference is not.
        if !context.in_render
            || !member_call_name(&call.callee)
                .is_some_and(|name| SYNCHRONOUS_CALLBACKS.contains(&name))
        {
            return;
        }

        for argument in &call.arguments {
            let Some(expression) = argument.as_expression() else {
                continue;
            };
            if let Some(span) = fresh_callback(unwrap_expression(expression)) {
                self.diagnostics
                    .push(report(self.source, span.start, RULE, self.message(span, context)));
            }
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
                .push(report(self.source, span.start, RULE, self.message(span, context)));
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
            self.message(function.span, context),
        ));
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    let semantic = build_semantic(program);

    check_with_semantic(program, source, &semantic)
}

/// Runs the rule with a semantic pass shared across rules.
pub(in crate::rules) fn check_with_semantic<'a, 's>(
    program: &Program<'a>,
    source: &'s Source<'s>,
    semantic: &'s Semantic<'a>,
) -> Vec<Diagnostic> {
    let index = CaptureIndex::new(semantic);
    walk_rule(
        program,
        Check {
            source,
            semantic,
            index,
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
            false,
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
    fn a_per_item_handler_inside_a_map_is_reported_with_the_map_callback() {
        let source = render(
            "        return items.map(item => <li onClick={() => this.select(item.id)}/>);",
        );

        // Both the map callback itself and the inner handler arrow are fresh functions.
        let diagnostics = diagnose(&source, check);
        assert_eq!(lines(&diagnostics), [3, 3]);
    }

    #[test]
    fn a_map_callback_arrow_is_reported() {
        let source = render("        return ids.map((id) => <TodoItem key={id} id={id}/>);");
        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_map_function_expression_callback_is_reported() {
        let source = render("        return ids.forEach(function (id) { list(id); });");
        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_sort_comparator_is_reported() {
        let source = render("        return items.sort((a, b) => a.id - b.id);");
        assert_eq!(lines(&diagnose(&source, check)), [3]);
    }

    #[test]
    fn a_callback_capturing_this_is_deduplicated_with_h29() {
        let source = render("        return ids.map((id) => <Row label={this.label(id)}/>);");

        let diagnostics = run_rules(&source);
        assert_eq!(lines(&diagnostics), [3]);
        assert_eq!(
            rules_on_line(&diagnostics, 3),
            vec![require_method_for_closure::RULE],
            "{diagnostics:#?}"
        );
    }

    #[test]
    fn a_callback_without_context_is_deduplicated_with_h30() {
        let source = render("        return ids.map((id) => <TodoItem key={id} id={id}/>);");

        let diagnostics = run_rules(&source);
        assert_eq!(lines(&diagnostics), [3]);
        assert_eq!(
            rules_on_line(&diagnostics, 3),
            vec![require_module_function::RULE],
            "{diagnostics:#?}"
        );
    }

    #[test]
    fn a_method_reference_callback_is_not_reported() {
        let source = render("        return ids.map(this.renderItem);");
        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn a_local_reference_callback_is_not_reported() {
        let source = render("        return ids.map(renderRow);");
        assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
    }

    #[test]
    fn an_async_callback_is_not_reported() {
        let source = render("        setTimeout(() => this.tick(), 0);");
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

        // The cast hides the arrow from nothing: the callback and the inner handler both report.
        let diagnostics = diagnose(&source, check);
        assert_eq!(lines(&diagnostics), [3, 3]);
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
