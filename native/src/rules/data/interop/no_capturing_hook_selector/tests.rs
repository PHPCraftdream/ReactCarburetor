use super::{check, RULE};
use crate::rules::support::testing::{diagnose, lines};

fn assert_lines(source: &str, expected_lines: &[usize]) {
    let diagnostics = diagnose(source, check);
    assert_eq!(lines(&diagnostics), expected_lines);
    assert!(diagnostics.iter().all(|diagnostic| diagnostic.rule == RULE));
}

#[test]
fn reports_render_state_captured_by_inline_hook_selectors() {
    assert_lines(
        "function Panel(props) {\n  useCarburetorValue(source, value => value[props.key]);\n  return <div />;\n}",
        &[2],
    );
    assert_lines(
        "function Panel(props) {\n  useResourceValue(source, args, value => value[props.key]);\n  return <div />;\n}",
        &[2],
    );
}

#[test]
fn accepts_comparator_captures_and_reports_selector_captures() {
    assert_lines(
        "const keyName = 'name';\nfunction Panel() {\n  useCarburetorValue(source, value => value[keyName]);\n  useResourceValue(source, args, value => value.name);\n  useComputedValue(computed);\n  return <div />;\n}",
        &[],
    );
    assert_lines(
        "function Panel(props) {\n  useCarburetorValue(source, value => value.name, (a, b) => Math.abs(a - b) < props.epsilon);\n  useResourceValue(source, args, value => value.name, (a, b) => a === b && props.epsilon > 0);\n  return <div />;\n}",
        &[],
    );
    assert_lines(
        "function Panel(props) {\n  useCarburetorValue(source, value => value[props.key]);\n  return <div />;\n}",
        &[2],
    );
}

#[test]
fn respects_shadowing_and_nested_callback_references() {
    assert_lines(
        "function Panel(props) {\n  useCarburetorValue(source, props => props.name);\n  return <div />;\n}",
        &[],
    );
    assert_lines(
        "function Panel(props) {\n  useResourceValue(source, args, value => value.items.map(item => item[props.key]));\n  return <div />;\n}",
        &[2],
    );
}

#[test]
fn round_four_comparator_captures_are_clean_but_selectors_are_reported() {
    assert_lines(
        "import {useCarburetorValue} from '@react-carburetor/core/interop';\nconst selectCount = (s: {count: number}) => s.count;\nexport function Panel({store, epsilon}: {store: any; epsilon: number}) {\n    const value = useCarburetorValue(store, selectCount, (a: number, b: number) => Math.abs(a - b) < epsilon);\n    return <span>{value}</span>;\n}",
        &[],
    );
    assert_lines(
        "function Panel(props) {\n  useResourceValue(source, args, value => value[props.key]);\n  return <div />;\n}",
        &[2],
    );
}

#[test]
fn round_four_computed_value_has_no_selector() {
    assert_lines(
        "function Panel(props) {\n  useComputedValue(() => props.value);\n  return <div />;\n}",
        &[],
    );
}

#[test]
fn round_four_resource_inline_args_capture_is_clean() {
    assert_lines(
        "function Panel(props) {\n  useResourceValue(source, [() => props.id], selectValue);\n  return <div />;\n}",
        &[],
    );
}
#[test]
fn round_five_resource_named_selector_with_inline_comparator_is_clean() {
    assert_lines(
        "function Panel(props) {\n  useResourceValue(source, args, selectValue, (a, b) => a === b && props.epsilon > 0);\n  return <div />;\n}",
        &[],
    );
}
#[test]
fn accepts_comparator_capturing_typescript_source() {
    assert_lines(
        "import {useCarburetorValue} from '@react-carburetor/core/interop';\nconst selectCount = (s: {count: number}) => s.count;\nexport function Panel({store, epsilon}: {store: any; epsilon: number}) {\n    const value = useCarburetorValue(store, selectCount, (a: number, b: number) => Math.abs(a - b) < epsilon);\n    return <span>{value}</span>;\n}",
        &[],
    );
}
#[test]
fn ignores_non_components_and_custom_hooks() {
    assert_lines(
        "function helper(props) { useCarburetorValue(source, value => value[props.key]); return null; }\nfunction Panel(props) { useCustomHook(value => value[props.key]); return <div />; }\nfunction Plain(props) { useComputedValue(computed); return null; }",
        &[],
    );
}

#[test]
fn reports_selector_capturing_only_component_parameter_inside_map() {
    let source = "function Row({id, items}) { return <ul>{items.map(item => <li>{useCarburetorValue(store, value => value[id])}</li>)}</ul>; }";
    let diagnostics = diagnose(source, check);
    assert_eq!(diagnostics.len(), 1, "{diagnostics:#?}");
    assert_eq!(diagnostics[0].rule, RULE);
}

#[test]
fn recognizes_arrow_and_memo_component_forms() {
    for source in [
        "const Panel = props => { useCarburetorValue(source, value => value[props.key]); return <div />; };",
        "const Panel = props => { useComputedValue(computed); useCarburetorValue(source, value => value[props.key]); return <div />; };",
        "const Panel = function(props) { useResourceValue(source, args, value => value[props.key]); return <div />; };",
        "const Panel = memo(props => { useCarburetorValue(source, value => value[props.key]); return <div />; });",
        "const Panel = forwardRef((props, ref) => { useCarburetorValue(source, value => value[props.key]); return <div ref={ref} />; });",
        "const Panel = React.memo(function Panel(props) { useResourceValue(source, args, value => value[props.key]); return <div />; });",
        "const Panel = React.forwardRef((props, ref) => { useCarburetorValue(source, value => value[props.key]); return <div ref={ref} />; });",
    ] {
        let diagnostics = diagnose(source, check);
        assert_eq!(lines(&diagnostics), [1], "{source}");
        assert!(diagnostics.iter().all(|diagnostic| diagnostic.rule == RULE));
    }
}
