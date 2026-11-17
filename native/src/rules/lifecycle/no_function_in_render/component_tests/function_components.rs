use crate::rules::allocations::{require_method_for_closure, require_module_function};
use crate::rules::lifecycle::{no_function_in_render as h31, no_handler_created_in_render};
use crate::rules::support::bases::Bases;
use crate::rules::support::testing::{diagnose, lines};
use crate::{config::Config, Diagnostic, Source};
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;
use std::path::Path;

fn run_registry(source: &str) -> Vec<Diagnostic> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::tsx()).parse();
    assert!(
        parsed.diagnostics.is_empty(),
        "test source must parse: {:?}",
        parsed.diagnostics
    );
    crate::rules::run(
        &parsed.program,
        &Source::new(Path::new("fixture.tsx"), source),
        &Config::default(),
        false,
    )
}

fn assert_component_rule(
    source: &str,
    check: fn(&oxc_ast::ast::Program<'_>, &Source<'_>, &Bases) -> Vec<Diagnostic>,
    expected_rule: &str,
    expected_line: usize,
) {
    let diagnostics = diagnose(source, check);
    assert_eq!(lines(&diagnostics), [expected_line], "{diagnostics:#?}");
    assert_eq!(diagnostics[0].rule, expected_rule, "{diagnostics:#?}");
}

#[test]
fn function_component_h31_reports_dom_locals_declarations_and_array_callbacks() {
    for source in [
        "function Row({ id }) { return <button onClick={() => select(id)}/>; }",
        "function Row({ id }) { const handler = () => select(id); return <button onClick={handler}/>; }",
        "function Row({ id }) { function handler() { select(id); } return <button onClick={handler}/>; }",
        "function Row({ ids }) { return <ul>{ids.map(id => <li key={id}/>)}</ul>; }",
    ] {
        assert_component_rule(source, h31::check, h31::RULE, 1);
    }
}

#[test]
fn function_component_h21_reports_fresh_component_props_but_not_dom_props() {
    assert_component_rule(
        "function Row({ id }) { return <Child onSelect={() => select(id)}/>; }",
        no_handler_created_in_render::check,
        no_handler_created_in_render::RULE,
        1,
    );
    assert!(diagnose(
        "function Row({ id }) { return <button onClick={() => select(id)}/>; }",
        no_handler_created_in_render::check,
    )
    .is_empty());
}

#[test]
fn function_component_capture_free_handlers_recommend_module_function_and_are_h30_deduped() {
    let source = "function Row() { const handler = () => moduleHandler(); return <Child onSelect={handler}/>; }\nfunction moduleHandler() {}";
    assert!(diagnose(source, no_handler_created_in_render::check).is_empty());
    let diagnostics = run_registry(source);
    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.rule.as_str())
            .collect::<Vec<_>>(),
        [require_module_function::RULE]
    );
    let local = "function Row() { const handler = () => moduleHandler(); return <button onClick={handler}/>; }\nfunction moduleHandler() {}";
    let diagnostics = run_registry(local);
    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.rule.as_str())
            .collect::<Vec<_>>(),
        [require_module_function::RULE]
    );
}

#[test]
fn function_component_captures_get_hook_free_child_advice() {
    for source in [
        "function Row(props) { return <Child onSelect={() => select(props.id)}/>; }",
        "function Row({ id: itemId }) { return <Child onSelect={() => select(itemId)}/>; }",
        "function Row({ id }) { const local = id; return <Child onSelect={() => select(local)}/>; }",
        "function Row({ id }) { const handler = () => () => select(id); return <Child onSelect={() => handler()}/>; }",
    ] {
        let h21 = diagnose(source, no_handler_created_in_render::check);
        assert_eq!(h21.len(), 1, "{h21:#?}");
        assert_eq!(h21[0].rule, no_handler_created_in_render::RULE);
        assert!(h21[0].message.contains("child AntiHookComponent"), "{}", h21[0].message);
        assert!(h21[0].message.contains("@bind"), "{}", h21[0].message);
        assert!(!h21[0].message.contains("useCallback"), "{}", h21[0].message);
        let registry = run_registry(source);
        // H31 never reports on a component prop — that is H21's boundary — and a capturing
        // handler must get the child-component advice, not the module-level one.
        assert!(registry.iter().any(|diagnostic| diagnostic.rule == no_handler_created_in_render::RULE), "{registry:#?}");
        assert!(registry.iter().all(|diagnostic| !diagnostic.message.contains("module-level")), "{registry:#?}");
    }
}

#[test]
fn functional_h31_honors_shadowing_and_non_render_function_boundaries() {
    let source = "function Row({ id }) { function nested(id) { return () => id; } return <button onClick={() => select(id)}/>; }";
    let diagnostics = diagnose(source, h31::check);
    assert_eq!(diagnostics.len(), 2, "{diagnostics:#?}");
    assert!(diagnostics
        .iter()
        .all(|diagnostic| diagnostic.rule.as_str() == h31::RULE));
    let module_binding =
        "const binding = 1; function Row() { return <Child onSelect={() => select(binding)}/>; }";
    let diagnostics = diagnose(module_binding, no_handler_created_in_render::check);
    assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
    assert_eq!(diagnostics[0].rule, no_handler_created_in_render::RULE);
    assert!(
        diagnostics[0].message.contains("module-level"),
        "{}",
        diagnostics[0].message
    );
}

#[test]
fn hook_wrapped_function_values_are_reported_for_h21_and_h31() {
    for value in [
        "useCallback(() => select(id), [id])",
        "useMemo(() => () => select(id), [id])",
        "useMemo(() => { return function () { select(id); }; }, [id])",
        "useCallback(select.bind(null, id), [id])",
    ] {
        let child = format!("function Row({{ id }}) {{ return <Child onSelect={{{value}}}/>; }}");
        assert_component_rule(
            &child,
            no_handler_created_in_render::check,
            no_handler_created_in_render::RULE,
            1,
        );
        let local = format!("function Row({{ id }}) {{ const handler = {value}; return <button onClick={{handler}}/>; }}");
        let diagnostics = run_registry(&local);
        assert_eq!(
            diagnostics
                .iter()
                .map(|diagnostic| diagnostic.rule.as_str())
                .collect::<Vec<_>>(),
            [h31::RULE]
        );
    }
}

#[test]
fn round_four_hook_wrapped_local_function_declarations_and_expressions_are_allocation_site_owned() {
    for source in [
        "function Row({ id }) { function handler() { select(id); } return <Child onSelect={useCallback(handler, [])}/>; }",
        "function Row({ id }) { const handler = function () { select(id); }; return <Child onSelect={useCallback(handler, [])}/>; }",
        "function Row({ id }) { function handler() { select(id); } return <Child onSelect={useMemo(() => handler, [])}/>; }",
        "function Row({ id }) { const handler = function () { select(id); }; return <Child onSelect={useMemo(() => { return handler; }, [])}/>; }",
    ] {
        assert!(diagnose(source, no_handler_created_in_render::check).is_empty(), "{source}");
        let diagnostics = run_registry(source);
        assert_eq!(diagnostics.iter().map(|diagnostic| diagnostic.rule.as_str()).collect::<Vec<_>>(), [h31::RULE], "{diagnostics:#?}");
        assert_eq!(diagnostics[0].column, if source.contains("function handler") { source.find("function handler").unwrap() + 1 } else { source.find("function ()").unwrap() + 1 });
    }
}

#[test]
fn round_four_hook_wrapped_local_handler_functions_are_owned_by_h31_not_h21() {
    for source in [
        "function Row({ id }) { function handler() { select(id); } return <Child onSelect={useCallback(handler, [])}/>; }",
        "function Row({ id }) { function handler() { select(id); } return <Child onSelect={useMemo(() => handler, [])}/>; }",
        "function Row({ id }) { function handler() { select(id); } return <Child onSelect={useMemo(() => { return handler; }, [])}/>; }",
        "function Row({ id }) { const handler = function () { select(id); }; return <Child onSelect={useCallback(handler, [])}/>; }",
        "function Row({ id }) { const handler = function () { select(id); }; return <Child onSelect={useMemo(() => handler, [])}/>; }",
        "function Row({ id }) { const handler = function () { select(id); }; return <Child onSelect={useMemo(() => { return handler; }, [])}/>; }",
    ] {
        assert!(diagnose(source, no_handler_created_in_render::check).is_empty(), "{source}");
        let diagnostics = run_registry(source);
        assert_eq!(diagnostics.iter().map(|diagnostic| diagnostic.rule.as_str()).collect::<Vec<_>>(), [h31::RULE], "{diagnostics:#?}");
        assert_eq!(diagnostics[0].column, if source.contains("function handler") { source.find("function handler").unwrap() + 1 } else { source.find("function ()").unwrap() + 1 });
    }
}

#[test]
fn h21_hook_wrapped_handlers_only_report_local_function_allocations() {
    for source in [
        "function moduleHandler() { select(1); } function Row() { return <Child onSelect={useCallback(moduleHandler, [])}/>; }",
        "function Row({ handler }) { return <Child onSelect={useCallback(handler, [])}/>; }",
        "function Row({ id }) { const value = useMemo(() => id + 1, []); return <Child value={value}/>; }",
        "function Row() { return <Child value={React.useMemo(() => 42, [])}/>; }",
        "function Row() { return <Child value={React.useMemo(function () { return 42; }, [])}/>; }",
    ] {
        assert!(diagnose(source, no_handler_created_in_render::check).is_empty(), "{source}");
    }
}

#[test]
fn scalar_memos_and_passthrough_props_are_not_function_allocations() {
    for source in [
        "function Row({ id }) { const value = useMemo(() => id + 1, [id]); return <button onClick={handle}/>; }",
        "function Row({ handler }) { return <Child onSelect={handler}/>; }",
        "function Row({ handler }) { return <button onClick={handler}/>; }",
    ] {
        assert!(diagnose(source, h31::check).is_empty(), "{source}");
        assert!(diagnose(source, no_handler_created_in_render::check).is_empty(), "{source}");
    }
}

#[test]
fn round_four_callback_returning_named_handlers_are_not_h21_prop_allocations() {
    for value in [
        "useCallback(handler, [])",
        "useMemo(() => handler, [])",
        "useMemo(() => { return handler; }, [])",
    ] {
        let source = format!("function Row({{ id }}) {{ const handler = () => select(id); return <Child onSelect={{{value}}}/>; }}");
        assert!(
            diagnose(&source, no_handler_created_in_render::check).is_empty(),
            "{source}"
        );
        let diagnostics = run_registry(&source);
        assert_eq!(
            diagnostics
                .iter()
                .map(|diagnostic| diagnostic.rule.as_str())
                .collect::<Vec<_>>(),
            [h31::RULE],
            "{diagnostics:#?}"
        );
        assert_eq!(diagnostics[0].column, source.find("() =>").unwrap() + 1);
    }
    let scalar = "function Row({ id }) { const value = useMemo(() => id + 1, []); return <Child value={value}/>; }";
    assert!(diagnose(scalar, no_handler_created_in_render::check).is_empty());
}

#[test]
fn hook_wrapped_capture_free_child_props_registry_have_exactly_one_h21() {
    for value in [
        "useCallback(() => console.log(1), [])",
        "useMemo(() => () => console.log(1), [])",
        "useMemo(() => { return () => console.log(1); }, [])",
        "React.useMemo(() => { return () => console.log(1); }, [])",
        "React.useMemo(function () { return () => console.log(1); }, [])",
    ] {
        let source = format!("function Row() {{ return <Child onSelect={{{value}}}/>; }}");
        let diagnostics = run_registry(&source);
        assert_eq!(
            diagnostics
                .iter()
                .map(|diagnostic| diagnostic.rule.as_str())
                .collect::<Vec<_>>(),
            [no_handler_created_in_render::RULE]
        );
    }
}

#[test]
fn nested_map_handler_and_hooks_use_function_component_capture_advice() {
    for (source, rule) in [
        ("function Row({ id, items }) { return <ul>{items.map(item => <Child onSelect={() => select(id)}/>)}</ul>; }", no_handler_created_in_render::RULE),
        ("function Row({ id, items }) { return <ul>{items.map(item => <Child onSelect={() => select(id, item)}/>)}</ul>; }", h31::RULE),
    ] {
        let check = if rule == no_handler_created_in_render::RULE { no_handler_created_in_render::check } else { h31::check };
        let diagnostics = diagnose(source, check);
        assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
        assert_eq!(diagnostics[0].rule, rule);
        assert!(diagnostics[0].message.contains("AntiHookComponent"), "{}", diagnostics[0].message);
        assert!(diagnostics[0].message.contains("@bind"), "{}", diagnostics[0].message);
        assert!(!diagnostics[0].message.contains("module-level"), "{}", diagnostics[0].message);
    }
}

#[test]
fn h31_map_callback_capturing_only_component_id_uses_child_advice() {
    let source = "function Row({ id, items }) { return <ul>{items.map(item => select(id))}</ul>; }";
    let diagnostics = diagnose(source, h31::check);
    assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
    assert_eq!(diagnostics[0].rule, h31::RULE);
    assert!(
        diagnostics[0].message.contains("child AntiHookComponent"),
        "{}",
        diagnostics[0].message
    );
}

#[test]
fn h29_reports_class_component_closure_but_not_function_component_closure() {
    let class_source = "class View extends AntiHookComponent { render() { return <button onClick={() => this.pick()}/>; } }";
    let diagnostics = diagnose(class_source, require_method_for_closure::check);
    assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
    assert_eq!(diagnostics[0].rule, require_method_for_closure::RULE);
    let function_source = "function View() { return <button onClick={() => pick()}/>; }";
    assert!(diagnose(function_source, require_method_for_closure::check).is_empty());
}

#[test]
fn h30_reports_capture_free_class_handler() {
    let source = "class View extends AntiHookComponent { render() { return <button onClick={() => console.log(1)}/>; } }";
    let diagnostics = diagnose(source, require_module_function::check);
    assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
    assert_eq!(diagnostics[0].rule, require_module_function::RULE);
}

#[test]
fn class_component_this_handler_recommends_bound_props_without_hooks() {
    let source = "function Row({ id }) { return <button onClick={() => this.pick(id)}/>; }";
    let diagnostics = diagnose(source, h31::check);
    assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
    assert_eq!(diagnostics[0].rule, h31::RULE);
    assert!(
        diagnostics[0].message.contains("@bind"),
        "{}",
        diagnostics[0].message
    );
    assert!(
        diagnostics[0].message.contains("props"),
        "{}",
        diagnostics[0].message
    );
    assert!(
        !diagnostics[0].message.contains("useCallback"),
        "{}",
        diagnostics[0].message
    );
    assert!(
        diagnostics[0]
            .message
            .contains("convert this component to AntiHookComponent"),
        "{}",
        diagnostics[0].message
    );
}

#[test]
fn round_three_scalar_memo_prop_keeps_exactly_h30() {
    for factory in [
        "useMemo(() => 42, [])",
        "useMemo(() => { return 42; }, [])",
        "React.useMemo(() => 42, [])",
        "useMemo(function () { return 42; }, [])",
    ] {
        let source = format!("function Row() {{ return <Child value={{{factory}}}/>; }}");
        let diagnostics = run_registry(&source);
        assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
        assert_eq!(diagnostics[0].rule, require_module_function::RULE);
        assert!(!diagnostics
            .iter()
            .any(|diagnostic| diagnostic.rule.as_str() == no_handler_created_in_render::RULE));
        assert!(!diagnostics
            .iter()
            .any(|diagnostic| diagnostic.rule.as_str() == h31::RULE));
        assert_eq!(
            (diagnostics[0].line, diagnostics[0].column),
            (1, source.find("useMemo(").unwrap() + "useMemo(".len() + 1)
        );
    }
}

#[test]
fn round_four_scale_2000_capture_free_jsx_handlers() {
    use std::time::Instant;
    let mut source = String::from("function Row() { return <div>");
    for index in 0..2000 {
        source.push_str(&format!(
            "<Child key=\"{index}\" onSelect={{() => globalHandler({index})}}/>"
        ));
    }
    source.push_str("</div>; }");
    let started = Instant::now();
    let diagnostics = diagnose(&source, no_handler_created_in_render::check);
    eprintln!("round_four_scale: 2000 handlers in {:?}", started.elapsed());
    assert_eq!(diagnostics.len(), 2000, "{diagnostics:#?}");
    assert!(diagnostics
        .iter()
        .all(|diagnostic| diagnostic.rule.as_str() == no_handler_created_in_render::RULE));
}

#[test]
fn round_four_factory_hoc_nested_capture_advice_stays_local() {
    for source in [
        "function makeRow(id) { const handler = () => select(id); return memo(function Row() { return <button onClick={() => select(handler)}/>; }); }",
        "function withRow(id) { const handler = () => select(id); return (Component) => memo(function Row() { return <button onClick={() => select(handler)}/>; }); }",
        "function Row({ id }) { function Inner() { const handler = () => select(id); return <button onClick={handler}/>; } return <section><Inner /></section>; }",
    ] {
        // A nested component declaration is itself re-created on every render of its parent, so
        // the third source reports Inner and its handler; the factory/HOC forms report once.
        let expected = if source.contains("function Inner()") { 2 } else { 1 };
        let diagnostics = diagnose(source, h31::check);
        assert_eq!(diagnostics.len(), expected, "{diagnostics:#?}");
        for diagnostic in &diagnostics {
            assert_eq!(diagnostic.rule, h31::RULE);
            assert!(!diagnostic.message.contains("module"), "{}", diagnostic.message);
            assert!(diagnostic.message.contains("AntiHookComponent"), "{}", diagnostic.message);
        }
    }
}

#[test]
fn round_four_copied_sources_exercise_h21_and_h31_advice() {
    let p2 = include_str!("p2.tsx");
    let h21 = diagnose(p2, no_handler_created_in_render::check);
    assert_eq!(h21.len(), 1, "{h21:#?}");
    assert!(
        h21[0].message.contains("child AntiHookComponent"),
        "{}",
        h21[0].message
    );
    assert!(h21[0].message.contains("@bind"), "{}", h21[0].message);
    let p3 = include_str!("p3.tsx");
    let h31_diagnostics = diagnose(p3, h31::check);
    assert_eq!(h31_diagnostics.len(), 1, "{h31_diagnostics:#?}");
    assert_eq!(h31_diagnostics[0].rule, h31::RULE);
    assert!(h31_diagnostics[0].column > 1);
}

#[test]
fn lexical_this_and_arguments_remain_h21_and_h31() {
    for source in [
        "function Row() { return <Child onSelect={() => this.pick()}/>; }",
        "function Row() { return <Child onSelect={() => arguments[0]}/>; }",
    ] {
        let h21 = diagnose(source, no_handler_created_in_render::check);
        assert_eq!(h21.len(), 1, "{h21:#?}");
        assert!(!h21[0].message.contains("module"), "{}", h21[0].message);
    }
    for source in [
        "function Row() { return <button onClick={() => this.pick()}/>; }",
        "function Row() { const handler = () => arguments[0]; return <button onClick={handler}/>; }",
    ] {
        let diagnostics = diagnose(source, h31::check);
        assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
        assert_eq!(diagnostics[0].rule, h31::RULE);
        assert!(!diagnostics[0].message.contains("module"), "{}", diagnostics[0].message);
    }
}

#[test]
fn function_component_this_hook_is_class_only() {
    let source = "function Row() { this.useCarburetor(store); return <div />; }";
    assert!(diagnose(
        source,
        crate::rules::data::reads::no_use_carburetor_outside_render::check
    )
    .is_empty());
}

#[test]
fn conditional_and_logical_component_props_report_once_through_the_full_registry() {
    for source in [
        "const enabled = true;\nfunction act() {}\nfunction Row() { return <Child onSelect={enabled ? () => act() : undefined}/>;\n}\n",
        "const enabled = true;\nfunction act() {}\nfunction Row() { return <Child onSelect={enabled && (() => act())}/>;\n}\n",
        "const enabled = true;\nfunction act() {}\nclass View extends AntiHookComponent {\n    render() {\n        return <Child onSelect={enabled ? () => act() : undefined}/>;\n    }\n}\n",
    ] {
        let diagnostics = run_registry(source);
        assert_eq!(
            diagnostics.iter().map(|diagnostic| diagnostic.rule.as_str()).collect::<Vec<_>>(),
            [no_handler_created_in_render::RULE],
            "{diagnostics:#?}"
        );
    }
}

#[test]
fn conditional_prop_handling_keeps_nested_functions_with_h30() {
    let source = "function act() {}\nconst enabled = true;\nfunction Row() { return <Child onSelect={enabled ? () => { const nested = () => act(); } : undefined}/>;\n}\n";
    let diagnostics = run_registry(source);
    let mut rules = diagnostics
        .iter()
        .map(|diagnostic| diagnostic.rule.as_str())
        .collect::<Vec<_>>();
    rules.sort_unstable();
    assert_eq!(
        rules,
        [
            no_handler_created_in_render::RULE,
            require_module_function::RULE
        ],
        "{diagnostics:#?}"
    );
}

#[test]
fn a_function_a_usememo_factory_builds_and_returns_is_h31s() {
    for (factory, marker) in [
        ("useMemo(() => { const fn = () => select(id); return fn; }, [id])", "() => select"),
        ("useMemo(() => { function inner() { select(id); } return inner; }, [id])", "function inner"),
        ("useMemo(() => { const fn = () => select(id); if (id) return fn; return undefined; }, [id])", "() => select"),
    ] {
        let source = format!("function Row({{ id }}) {{ const handler = {factory}; return <button onClick={{handler}}/>; }}");
        let diagnostics = diagnose(&source, h31::check);
        assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
        assert_eq!(diagnostics[0].rule, h31::RULE);
        assert_eq!(diagnostics[0].column, source.find(marker).unwrap() + 1, "{source}");
        let registry = run_registry(&source);
        assert_eq!(registry.iter().map(|diagnostic| diagnostic.rule.as_str()).collect::<Vec<_>>(), [h31::RULE], "{registry:#?}");
    }
}

#[test]
fn a_hook_passing_a_render_local_through_stays_with_the_declarator_report() {
    for factory in [
        "useMemo(() => handler, [])",
        "useMemo(() => { return handler; }, [])",
        "useCallback(handler, [])",
    ] {
        let source = format!("function Row({{ id }}) {{ const handler = () => select(id); const memo = {factory}; return <button onClick={{memo}}/>; }}");
        let registry = run_registry(&source);
        assert_eq!(
            registry
                .iter()
                .map(|diagnostic| diagnostic.rule.as_str())
                .collect::<Vec<_>>(),
            [h31::RULE],
            "{registry:#?}"
        );
        assert_eq!(
            registry[0].column,
            source.find("() => select").unwrap() + 1,
            "{source}"
        );
    }

    let module_handler = "function handler() {}\nfunction Row() { const memo = useMemo(() => handler, []); return <button onClick={memo}/>;\n}\n";
    let registry = run_registry(module_handler);
    assert_eq!(
        registry
            .iter()
            .map(|diagnostic| diagnostic.rule.as_str())
            .collect::<Vec<_>>(),
        [require_module_function::RULE],
        "{registry:#?}"
    );
}

#[test]
fn a_function_in_a_prop_tests_condition_is_not_a_component_prop_allocation() {
    let source =
        "function act() {}\nfunction Row() { return <Child value={(() => act()) ? 1 : 2}/>;\n}\n";
    let diagnostics = run_registry(source);
    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.rule.as_str())
            .collect::<Vec<_>>(),
        [require_module_function::RULE],
        "{diagnostics:#?}"
    );
}

#[test]
fn wrapped_conditional_component_props_report_once_through_the_full_registry() {
    for source in [
        "const enabled = true;\nfunction act() {}\ntype Handler = (() => void) | undefined;\nfunction Row() { return <Child onSelect={(enabled ? () => act() : undefined) as Handler}/>;\n}\n",
        "const enabled = true;\nfunction act() {}\ntype Handler = (() => void) | undefined;\nfunction Row() { return <Child onSelect={enabled ? (() => act()) as Handler : undefined}/>;\n}\n",
        "const enabled = true;\nfunction act() {}\ntype Handler = (() => void) | undefined;\nclass View extends AntiHookComponent {\n    render() {\n        return <Child onSelect={(enabled ? () => act() : undefined) as Handler}/>;\n    }\n}\n",
        "const enabled = true;\nfunction act() {}\ntype Handler = (() => void) | undefined;\nclass View extends AntiHookComponent {\n    render() {\n        return <Child onSelect={enabled ? (() => act()) as Handler : undefined}/>;\n    }\n}\n",
    ] {
        let diagnostics = run_registry(source);
        assert_eq!(
            diagnostics.iter().map(|diagnostic| diagnostic.rule.as_str()).collect::<Vec<_>>(),
            [no_handler_created_in_render::RULE],
            "{diagnostics:#?}"
        );
    }
}
