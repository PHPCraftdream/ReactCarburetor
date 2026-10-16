use crate::rules::support::testing::diagnose;

#[test]
fn h1_function_component_get_data_message_points_to_hook() {
    let source = "function View({store}) { return <span>{store.getData().name}</span>; }";
    let diagnostics = diagnose(source, crate::rules::data::reads::no_get_data_in_render::check);
    assert_eq!(diagnostics.len(), 1);
    assert!(diagnostics[0].message.contains("useCarburetorValue"));
    assert!(!diagnostics[0].message.contains("this.useCarburetor"));
}

#[test]
fn h2_zero_argument_computed_get_is_reported_and_keyed_get_is_not() {
    let source = "function View({computed}) { return <span>{computed.get()}</span>; }";
    let diagnostics = diagnose(source, crate::rules::data::reads::no_computed_get_in_render::check);
    assert_eq!(diagnostics.len(), 1);
    assert!(diagnostics[0].message.contains("useComputedValue"));
    assert!(!diagnostics[0].message.contains("this.useComputed"));

    let keyed = "function View({computed, key}) { return <span>{computed.get(key)}</span>; }";
    assert!(diagnose(keyed, crate::rules::data::reads::no_computed_get_in_render::check).is_empty());
}

#[test]
fn h11_reports_store_writes_in_render_but_not_event_handlers() {
    for hook in ["useCarburetorValue", "useComputedValue", "useResourceValue"] {
        for write in ["store.write()", "store.clear()"] {
            let source = format!("function View() {{ const value = {hook}(store); {write}; return <span>{{value}}</span>; }}");
            let diagnostics = diagnose(&source, crate::rules::data::writes::no_store_write_in_render::check);
            assert_eq!(diagnostics.len(), 1, "{hook} / {write}");
            assert!(diagnostics[0].message.contains("event handler"));
            assert!(!diagnostics[0].message.contains("useEffects"));
        }
    }

    let handler = "function View() { const value = useCarburetorValue(store); return <button onClick={() => store.write()}>{value}</button>; }";
    assert!(diagnose(handler, crate::rules::data::writes::no_store_write_in_render::check).is_empty());

    let probe = "import {useCarburetorValue} from 'react-carburetor/interop';\n\
                  const selectCount = (s: {count: number}) => s.count;\n\
                  export function StorePanel({source}: {source: any}) {\n\
                  const value = useCarburetorValue(source, selectCount);\n\
                  return <span>{value}</span>;\n}\n\
                  export function PlainPanel({source}: {source: Map<string, number>}) {\n\
                  source.clear();\n    return <span />;\n}\n";
    let diagnostics = diagnose(probe, crate::rules::data::writes::no_store_write_in_render::check);
    assert!(diagnostics.is_empty(), "{diagnostics:#?}");
}

#[test]
fn h4_is_class_only_and_checks_nested_callbacks() {
    let class_source = "class View extends AntiHookComponent { render() { this.useCarburetor(store); return <button onClick={() => this.useComputed(computed)}/>; } }";
    assert_eq!(diagnose(class_source, crate::rules::data::reads::no_use_carburetor_outside_render::check).len(), 1);

    let function_source = "function View() { this.useCarburetor(store); return <button onClick={() => this.useComputed(computed)}/>; }";
    assert!(diagnose(function_source, crate::rules::data::reads::no_use_carburetor_outside_render::check).is_empty());
}

#[test]
fn h5_class_tracked_data_escape_is_reported_but_function_hook_capture_is_not() {
    let class_source = "class View extends AntiHookComponent { render() { const data = this.useCarburetor(store); return () => data.name; } }";
    assert_eq!(diagnose(class_source, crate::rules::data::reads::no_escaping_tracked_data::check).len(), 1);

    let function_source = "function View() { const data = useCarburetorValue(store); return <button onClick={() => data.name}/>; }";
    assert!(diagnose(function_source, crate::rules::data::reads::no_escaping_tracked_data::check).is_empty());

    let this_hook = "function View() { const data = this.useCarburetor(store); return <button onClick={() => data.name}/>; }";
    assert!(diagnose(this_hook, crate::rules::data::reads::no_escaping_tracked_data::check).is_empty());
}

#[test]
fn rsc_page_contract_uses_native_suppression_instead_of_class_component() {
    let page = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../scripts/consumer-fixture/next/page.tsx"));
    let allocator = oxc_allocator::Allocator::default();
    let parsed = oxc_parser::Parser::new(&allocator, page, oxc_span::SourceType::tsx()).parse();
    assert!(parsed.diagnostics.is_empty(), "{:#?}", parsed.diagnostics);
    let suppression = crate::suppression::Suppression::build(&parsed.program);
    let diagnostics = crate::rules::data::reads::no_get_data_in_render::check(
        &parsed.program,
        &crate::Source { path: std::path::Path::new("page.tsx"), text: page },
    );
    assert_eq!(diagnostics.len(), 1);
    assert!(suppression.silenced(&diagnostics[0].rule, diagnostics[0].line));
    assert!(!page.contains("extends AntiHookComponent"));
}

#[test]
fn native_suppression_silences_the_named_rule_on_the_next_line() {
    let source = "function View({store}) { return <span>{store.getData().name}</span>; }";
    let allocator = oxc_allocator::Allocator::default();
    let parsed = oxc_parser::Parser::new(&allocator, source, oxc_span::SourceType::tsx()).parse();
    assert!(parsed.diagnostics.is_empty(), "{:#?}", parsed.diagnostics);
    let suppression = crate::suppression::Suppression::build(&parsed.program);
    let diagnostics = crate::rules::data::reads::no_get_data_in_render::check(
        &parsed.program,
        &crate::Source { path: std::path::Path::new("fixture.tsx"), text: source },
    );
    assert_eq!(diagnostics.len(), 1);
    assert!(diagnostics[0].message.contains("useCarburetorValue"));
    assert!(!suppression.silenced(&diagnostics[0].rule, diagnostics[0].line));

    let suppressed = "// carburetor-disable-next-line carburetor/no-get-data-in-render -- Server Component: one-shot read, no subscription exists on the server\nfunction View({store}) { return <span>{store.getData().name}</span>; }";
    let allocator = oxc_allocator::Allocator::default();
    let parsed = oxc_parser::Parser::new(&allocator, suppressed, oxc_span::SourceType::tsx()).parse();
    assert!(parsed.diagnostics.is_empty(), "{:#?}", parsed.diagnostics);
    let suppression = crate::suppression::Suppression::build(&parsed.program);
    let diagnostics = crate::rules::data::reads::no_get_data_in_render::check(
        &parsed.program,
        &crate::Source { path: std::path::Path::new("fixture.tsx"), text: suppressed },
    );
    assert_eq!(diagnostics.len(), 1);
    assert!(suppression.silenced(&diagnostics[0].rule, diagnostics[0].line));
}
