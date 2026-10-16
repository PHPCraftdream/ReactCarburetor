use super::{check, RULE};
use crate::rules::support::testing::{diagnose, lines};

fn assert_lines(source: &str, expected_lines: &[usize]) {
    let diagnostics = diagnose(source, check);
    assert_eq!(lines(&diagnostics), expected_lines);
    assert!(diagnostics.iter().all(|diagnostic| diagnostic.rule == RULE));
}

#[test]
fn reports_identifier_and_object_destructuring_store_reads() {
    assert_lines(
        "function Panel() {\n  const value = useCarburetorValue(source);\n  const a = useMemo(() => value.name, []);\n  return <div>{a}</div>;\n}",
        &[3],
    );
    assert_lines(
        "function Panel() {\n  const { value } = useComputedValue(source);\n  const a = useCallback(() => value.name, []);\n  return <div>{a}</div>;\n}",
        &[3],
    );
}

#[test]
fn reports_array_destructuring_and_react_qualified_hooks() {
    assert_lines(
        "function Panel() {\n  const [value] = useResourceValue(source);\n  const a = React.useMemo(() => value.name, []);\n  return <div>{a}</div>;\n}",
        &[3],
    );
}

#[test]
fn ignores_shadowed_bindings_and_unrelated_components() {
    assert_lines(
        "const value = useCarburetorValue(source);\nfunction Panel() {\n  const fn = useMemo(() => value.name, []);\n  return <div>{fn}</div>;\n}\nfunction Other() {\n  const value = useCarburetorValue(source);\n  return <div />;\n}\nfunction plain() {\n  const value = useCarburetorValue(source);\n  const fn = useMemo(() => value.name, []);\n  return <div>{fn}</div>;\n}",
        &[],
    );
    assert_lines(
        "function Panel() {\n  const value = useCarburetorValue(source);\n  const fn = useMemo((value) => value.name, []);\n  return <div>{fn}</div>;\n}",
        &[],
    );
}

#[test]
fn isolates_nested_components_and_does_not_count_dependencies() {
    assert_lines(
        "function Outer() {\n  const value = useCarburetorValue(source);\n  function Inner() {\n    const fn = useMemo(() => value.name, []);\n    return <span>{fn}</span>;\n  }\n  const fn = useCallback(() => plain, [value]);\n  return <Inner />;\n}",
        &[],
    );
}

#[test]
fn callback_identifier_referencing_store_binding_is_reported() {
    assert_lines(
        "function Panel() {\n  const value = useCarburetorValue(source);\n  const select = () => value.name;\n  const memo = useMemo(select, []);\n  return <div>{memo}</div>;\n}",
        &[4],
    );
}

#[test]
fn round_four_function_declaration_deriving_store_value_with_memo_and_callback() {
    assert_lines(
        "import {useMemo} from 'react';\nimport {useCarburetorValue} from 'react-carburetor/interop';\nconst selectCount = (s: {count: number}) => s.count;\nexport function Panel({store}: {store: any}) {\n    const value = useCarburetorValue(store, selectCount);\n    function derive() { return value * 2; }\n    const doubled = useMemo(derive, [value]);\n    return <span>{doubled}</span>;\n}",
        &[7],
    );
    assert_lines(
        "function Panel() {\n  const value = useCarburetorValue(source);\n  function derive() { return value.name; }\n  const memo = useCallback(derive, []);\n  return <div>{memo}</div>;\n}",
        &[4],
    );
}
#[test]
fn round_five_type_only_reference_is_not_a_store_read() {
    assert_lines(
        "function Panel() {\n  const value = useCarburetorValue(source);\n  function derive(): typeof value { return 42; }\n  const memo = useMemo(derive, []);\n  return <div>{memo}</div>;\n}",
        &[],
    );
}

#[test]
fn round_six_deferred_binding_usecallback_is_reported() {
    assert_lines(
        "function Panel() {\n  const handler = useCallback(() => value, []);\n  const value = useComputedValue(source);\n  return <button onClick={handler}/>;\n}",
        &[2],
    );
}

#[test]
fn recognizes_arrow_and_memo_component_forms() {
    assert_lines(
        "const Panel = () => {\n  const value = useCarburetorValue(source);\n  const memo = useMemo(() => value.name, []);\n  return <div>{memo}</div>;\n};",
        &[3],
    );
    assert_lines(
        "const Panel = memo(() => {\n  const value = useComputedValue(source);\n  const memoized = useCallback(() => value.name, []);\n  return <div>{memoized}</div>;\n});",
        &[3],
    );
}

#[test]
fn reports_store_binding_captured_by_hook_inside_component_returned_map() {
    let source = "function Row({ items }) {\n  const value = useCarburetorValue(source);\n  return <ul>{items.map(item => { const memo = useMemo(() => value.name, []); return <li key={item}>{memo}</li>; })}</ul>;\n}";
    let diagnostics = diagnose(source, check);
    assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
    assert_eq!(diagnostics[0].rule, RULE);
    assert_eq!((diagnostics[0].line, diagnostics[0].column), (3, source.lines().nth(2).unwrap().find("useMemo").unwrap() + 1));
}

#[test]
fn reports_exact_location_of_memo_read_from_store_value() {
    let source = "function Panel() {\n  const value = useCarburetorValue(source);\n  const a = useMemo(() => value.name, []);\n  return <div>{a}</div>;\n}";
    let diagnostics = diagnose(source, check);
    assert_eq!(diagnostics.len(), 1);
    assert_eq!((diagnostics[0].line, diagnostics[0].column), (3, 13));
    assert_eq!(diagnostics[0].rule, RULE);
}

