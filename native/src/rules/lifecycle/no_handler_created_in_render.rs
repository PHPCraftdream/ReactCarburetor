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

use oxc_ast::ast::{JSXAttribute, Program};
use oxc_semantic::Semantic;

use crate::rules::report;
use crate::rules::support::bases::Bases;
use crate::rules::support::closures::{build_semantic, CaptureIndex};
use crate::rules::support::walk::functions::fresh_attribute_functions;
use crate::rules::support::walk::{walk_rule, Context, RenderKind, Rule};
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-handler-created-in-render";

struct Check<'s, 'a> {
    source: &'s Source<'s>,
    semantic: &'s Semantic<'a>,
    index: CaptureIndex<'a>,
    diagnostics: Vec<Diagnostic>,
}

impl<'a, 's> Rule<'a> for Check<'s, 'a> {
    fn finish(&mut self) -> Vec<Diagnostic> {
        std::mem::take(&mut self.diagnostics)
    }

    fn jsx_attribute(&mut self, attribute: &JSXAttribute<'a>, context: &Context) {
        if !context.in_render {
            return;
        }
        let mut spans = Vec::new();
        fresh_attribute_functions(&attribute.value, &mut spans);
        if spans.is_empty() {
            return;
        }

        let Some(element) = context.jsx_element.as_deref() else {
            return;
        };
        if !context.jsx_component {
            return;
        }

        let capture = spans
            .iter()
            .any(|span| self.index.captures_non_module(*span, self.semantic));
        let message = if context.render_kind == Some(RenderKind::Function) {
            if capture {
                format!("this prop is a new function on every render, so <{element}>'s props always compare as changed and the props gate stops bailing out — the cascade the engine exists to prevent comes back through the props. Pass the handler's data as props to a child AntiHookComponent that receives data as props and passes a @bind method, or convert this component to AntiHookComponent.")
            } else {
                format!("this prop is a new function on every render, so <{element}>'s props always compare as changed and the props gate stops bailing out — the cascade the engine exists to prevent comes back through the props. Move the handler to a module-level function.")
            }
        } else {
            format!(
                "this prop is a new function on every render, so <{element}>'s props always compare as \
                 changed and the props gate stops bailing out — the cascade the engine exists to prevent \
                 comes back through the props. Declare the handler as a method with @bind and pass it by \
                 reference."
            )
        };

        self.diagnostics
            .push(report(self.source, attribute.span.start, RULE, message));
    }
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source, bases: &Bases) -> Vec<Diagnostic> {
    let semantic = build_semantic(program);

    check_with_semantic(program, source, &semantic, bases)
}

/// Runs the rule with a semantic pass shared across rules.
pub(in crate::rules) fn check_with_semantic<'a, 's>(
    program: &Program<'a>,
    source: &'s Source<'s>,
    semantic: &'s Semantic<'a>,
    bases: &'s Bases,
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
        bases,
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
        format!("class Widget extends AntiHookComponent {{\n    render() {{\n{body}\n    }}\n}}\n")
    }

    fn run_rules_with_scope(
        text: &str,
        scope: crate::config::ModuleFunctionScope,
    ) -> Vec<Diagnostic> {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();

        assert!(
            parsed.diagnostics.is_empty(),
            "test source must parse: {:?}",
            parsed.diagnostics
        );

        let mut config = crate::config::Config::default();
        config.set_module_function_scope(scope);

        crate::rules::run(
            &parsed.program,
            &crate::Source::new(Path::new("fixture.tsx"), text),
            &config,
            false,
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
            &crate::Source::new(Path::new("fixture.tsx"), text),
            &crate::config::Config::default(),
            false,
        )
    }

    #[test]
    fn a_fresh_child_handler_reports_once_in_the_full_registry_for_both_scopes() {
        let source = "class View extends AntiHookComponent { render() { return <Child onClick={() => console.log(1)}/>; } }";

        for scope in [
            crate::config::ModuleFunctionScope::All,
            crate::config::ModuleFunctionScope::Classes,
        ] {
            let diagnostics = run_rules_with_scope(source, scope);

            assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
            assert_eq!(diagnostics[0].rule, RULE);
        }
    }

    #[test]
    fn module_function_boundary_keeps_component_handlers_out_but_nested_and_dom_functions_in() {
        let component = "class View extends AntiHookComponent { render() { return <Child onClick={() => { const nested = () => console.log(1); nested(); }}/>; } }";
        let dom = "class View extends AntiHookComponent { render() { return <button onClick={() => console.log(1)}/>; } }";

        for scope in [
            crate::config::ModuleFunctionScope::All,
            crate::config::ModuleFunctionScope::Classes,
        ] {
            let component_diagnostics = run_rules_with_scope(component, scope);
            assert!(component_diagnostics
                .iter()
                .any(|diagnostic| diagnostic.rule == RULE));
            assert!(
                component_diagnostics
                    .iter()
                    .any(|diagnostic| diagnostic.rule == "carburetor/require-module-function"),
                "{component_diagnostics:#?}"
            );

            let dom_diagnostics = run_rules_with_scope(dom, scope);
            assert!(
                dom_diagnostics
                    .iter()
                    .any(|diagnostic| diagnostic.rule == "carburetor/require-module-function"),
                "{dom_diagnostics:#?}"
            );
        }
    }

    #[test]
    fn ordinary_function_expression_child_handler_reports_h21() {
        let source = render("        return <Child onClick={function () { console.log(1); }}/>;");
        let diagnostics = run_rules(&source);

        assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
        assert_eq!(diagnostics[0].rule, RULE);
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
