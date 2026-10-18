use std::cell::RefCell;
use std::rc::Rc;

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::{SourceType, Span};

use super::{walk_rule, Context, Rule};
use crate::rules::support::bases::Bases;
use crate::Diagnostic;

#[derive(Clone, Debug, Eq, PartialEq)]
struct Observation {
    kind: &'static str,
    name: String,
    in_render: bool,
    in_component: bool,
    render_kind: Option<super::RenderKind>,
    function: Span,
}

#[derive(Clone, Default)]
struct Observe(Rc<RefCell<Vec<Observation>>>);

impl Observe {
    fn record(&self, kind: &'static str, name: impl Into<String>, context: &Context) {
        self.0.borrow_mut().push(Observation {
            kind,
            name: name.into(),
            in_render: context.in_render,
            in_component: context.in_component,
            render_kind: context.render_kind,
            function: context.function,
        });
    }
}

impl<'a> Rule<'a> for Observe {
    fn finish(&mut self) -> Vec<Diagnostic> {
        Vec::new()
    }

    fn function_declaration(&mut self, function: &oxc_ast::ast::Function<'a>, context: &Context) {
        if function.id.as_ref().is_some_and(|id| id.name == "Inner") {
            self.record("declaration", "Inner", context);
        }
    }

    fn call(&mut self, call: &oxc_ast::ast::CallExpression<'a>, context: &Context) {
        if let oxc_ast::ast::Expression::Identifier(identifier) = &call.callee {
            if identifier.name == "probe" {
                self.record("probe", "probe", context);
            }
        }
    }
}

fn observations(source: &str, source_type: SourceType) -> Vec<Observation> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, source_type).parse();
    assert!(
        parsed.diagnostics.is_empty(),
        "test source must parse: {:?}",
        parsed.diagnostics
    );
    let observer = Observe::default();
    let observations = Rc::clone(&observer.0);
    walk_rule(&parsed.program, observer, &Bases::default());
    Rc::try_unwrap(observations)
        .expect("observer dropped")
        .into_inner()
}

fn probe_contexts(source: &str) -> Vec<(bool, bool, Span, Option<super::RenderKind>)> {
    observations(source, SourceType::tsx())
        .into_iter()
        .filter(|observation| observation.kind == "probe")
        .map(|observation| {
            (
                observation.in_render,
                observation.in_component,
                observation.function,
                observation.render_kind,
            )
        })
        .collect()
}

fn render_flags(source: &str) -> Vec<(bool, bool, Option<super::RenderKind>)> {
    probe_contexts(source)
        .into_iter()
        .map(|(in_render, in_component, _, render_kind)| (in_render, in_component, render_kind))
        .collect()
}

#[test]
fn pascal_case_function_forms_with_own_jsx_are_render_scopes() {
    for source in [
        "function Row() { probe(); return <li/>; }",
        "const Row = () => { probe(); return <li/>; };",
        "const Row = function () { probe(); return <li/>; };",
        "export default function Row() { probe(); return <li/>; }",
    ] {
        assert_eq!(
            render_flags(source),
            [(true, false, Some(super::RenderKind::Function))],
            "{source}"
        );
    }
}

#[test]
fn jsx_must_be_in_the_function_own_body_and_binding_must_be_pascal_case() {
    for source in [
        "function Row() { probe(); return null; }",
        "function row() { probe(); return <li/>; }",
        "function Row() { function inner() { return <li/>; } probe(); return null; }",
    ] {
        assert_eq!(render_flags(source), [(false, false, None)], "{source}");
    }
}

#[test]
fn supported_wrappers_recognize_only_the_first_function_argument() {
    for wrapper in ["memo", "forwardRef", "React.memo", "React.forwardRef"] {
        let source = format!("const Row = {wrapper}(() => {{ probe(); return <li/>; }});");
        assert_eq!(
            render_flags(&source),
            [(true, false, Some(super::RenderKind::Function))],
            "{source}"
        );
    }
}

#[test]
fn wrappers_without_jsx_and_functions_in_later_arguments_are_not_components() {
    for source in [
        "const Row = memo(() => { probe(); return null; });",
        "const result = memo(other, () => { probe(); return <li/>; });",
    ] {
        assert_eq!(render_flags(source), [(false, false, None)], "{source}");
    }
}

#[test]
fn render_member_remains_render_but_component_context_stays_class_only() {
    let source = "class Row extends AntiHookComponent { render() { probe(); return <li/>; } }";
    assert_eq!(
        render_flags(source),
        [(true, true, Some(super::RenderKind::Class))]
    );
}

#[test]
fn nested_component_declaration_gets_outer_context_and_inner_body_owns_its_scope() {
    let source =
        "function Outer() { function Inner() { probe(); return <li/>; } probe(); return <div/>; }";
    let observed = observations(source, SourceType::tsx());
    let declaration = observed
        .iter()
        .find(|item| item.kind == "declaration")
        .unwrap();
    assert_eq!(
        (
            declaration.in_render,
            declaration.in_component,
            declaration.render_kind
        ),
        (true, false, Some(super::RenderKind::Function))
    );
    let probes = observed
        .iter()
        .filter(|item| item.kind == "probe")
        .collect::<Vec<_>>();
    assert_eq!(probes.len(), 2);
    assert_eq!(
        (
            probes[0].in_render,
            probes[0].in_component,
            probes[0].render_kind
        ),
        (true, false, Some(super::RenderKind::Function))
    );
    assert_eq!(
        (
            probes[1].in_render,
            probes[1].in_component,
            probes[1].render_kind
        ),
        (true, false, Some(super::RenderKind::Function))
    );
    assert_ne!(probes[0].function, probes[1].function);
}

#[test]
fn ordinary_nested_function_is_a_render_boundary_but_array_callback_is_synchronous() {
    let source = "function Row() { function later() { probe(); } items.map(item => probe()); probe(); return <li/>; }";
    let flags = render_flags(source);
    assert_eq!(
        flags,
        [
            (false, false, None),
            (true, false, Some(super::RenderKind::Function)),
            (true, false, Some(super::RenderKind::Function))
        ]
    );
    let scopes = probe_contexts(source);
    assert_ne!(scopes[0].2, scopes[1].2);
    assert_ne!(scopes[1].2, scopes[2].2);
}

#[test]
fn create_element_in_ts_does_not_enter_render_scope() {
    let source = "function Row() { probe(); return React.createElement('li'); }";
    assert_eq!(render_flags_for_ts(source), [(false, false, None)]);
}

fn render_flags_for_ts(source: &str) -> Vec<(bool, bool, Option<super::RenderKind>)> {
    observations(source, SourceType::ts())
        .into_iter()
        .filter(|observation| observation.kind == "probe")
        .map(|observation| {
            (
                observation.in_render,
                observation.in_component,
                observation.render_kind,
            )
        })
        .collect()
}

#[test]
fn parenthesized_satisfies_wrapped_jsx_expression_body_is_detected() {
    let source = "const Row = () => (probe(), (<><li/></>)) satisfies JSX.Element;";
    assert_eq!(
        render_flags(source),
        [(true, false, Some(super::RenderKind::Function))]
    );
}

#[test]
fn named_and_anonymous_wrapper_callbacks_ignore_binding_case() {
    for wrapper in ["memo", "forwardRef", "React.memo", "React.forwardRef"] {
        for callback in [
            "() => { probe(); return <li/>; }",
            "function () { probe(); return <li/>; }",
        ] {
            let source = format!("const row = {wrapper}({callback});");
            assert_eq!(
                render_flags(&source),
                [(true, false, Some(super::RenderKind::Function))],
                "{source}"
            );
        }
    }
}

#[test]
fn default_exported_wrapper_callback_is_a_render_scope() {
    let source = "export default memo(function () { probe(); return <li/>; });";
    let observed = observations(source, SourceType::tsx());
    assert_eq!(observed.len(), 1);
    assert!(observed[0].in_render);
    assert_eq!(observed[0].render_kind, Some(super::RenderKind::Function));
}

#[test]
fn only_supported_wrapper_objects_are_recognized() {
    let source = "const Row = Other.memo(() => { probe(); return <li/>; });";
    assert_eq!(render_flags(source), [(false, false, None)]);
}

#[test]
fn wrapped_first_argument_unwraps_typescript_expression_wrappers() {
    let source = "const row = memo((() => { probe(); return <li/>; }) satisfies Function);";
    assert_eq!(
        render_flags(source),
        [(true, false, Some(super::RenderKind::Function))]
    );
}

#[test]
fn local_jsx_and_jsx_in_parameters_do_not_make_a_component() {
    for source in [
        "function Row() { const vnode = <li/>; probe(); return null; }",
        "function Row(value = <li/>) { probe(); return null; }",
        "const Row = (value = <li/>) => { probe(); return null; };",
    ] {
        assert_eq!(render_flags(source), [(false, false, None)], "{source}");
    }
}
