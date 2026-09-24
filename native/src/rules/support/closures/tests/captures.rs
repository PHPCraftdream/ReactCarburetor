use super::*;

#[test]
fn an_inner_binding_shadows_the_outer_one_of_the_same_name() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    const x = this.props.x;
    const outer = () => {
        const x = 2;
        const inner = () => x;
        return inner;
    };
    return outer;
}
}
"#,
        true,
        |analysis| {
            assert_eq!(analysis.closures.len(), 2);

            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [] as [(&str, bool, bool, bool); 0]
            );

            assert_eq!(
                captures_digest(&analysis.closures[1]),
                [("x", false, false, false)]
            );
        },
    );
}

#[test]
fn a_hoisted_var_and_a_function_declaration_are_captures() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    const read = () => value + helper();
    var value = 3;
    function helper() {
        return 1;
    }
    return read;
}
}
"#,
        true,
        |analysis| {
            assert_eq!(analysis.closures.len(), 1);

            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [
                    ("value", false, false, false),
                    ("helper", false, false, false)
                ]
            );
        },
    );
}
#[test]
fn a_destructured_parameter_with_defaults_is_captured() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render({ width = 10, height = 20 }: { width?: number; height?: number } = {}) {
    return [1].map(() => width * height);
}
}
"#,
        true,
        |analysis| {
            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [
                    ("width", false, false, false),
                    ("height", false, false, false)
                ]
            );
        },
    );
}

#[test]
fn a_for_of_head_binding_is_captured() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    const handlers = [];
    for (const id of this.ids) {
        handlers.push(() => id);
    }
    return handlers;
}
}
"#,
        true,
        |analysis| {
            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [("id", false, false, false)]
            );
        },
    );
}

#[test]
fn a_catch_parameter_is_captured_and_an_unresolved_name_is_not() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    try {
        return [1].map(() => risky());
    } catch (problem) {
        return [1].map(() => problem.message);
    }
}
}
"#,
        true,
        |analysis| {
            assert_eq!(analysis.closures.len(), 2);

            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [] as [(&str, bool, bool, bool); 0]
            );

            assert_eq!(
                captures_digest(&analysis.closures[1]),
                [("problem", false, false, false)]
            );
        },
    );
}

#[test]
fn a_named_function_expressions_own_name_is_not_a_capture() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    const factory = function repeat(limit: number): number {
        return limit <= 0 ? 0 : repeat(limit - 1);
    };
    return factory;
}
}
"#,
        true,
        |analysis| {
            assert_eq!(analysis.closures.len(), 1);

            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [] as [(&str, bool, bool, bool); 0]
            );
        },
    );
}

#[test]
fn a_type_annotation_reference_is_not_a_capture() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    const Props = { width: 1 };
    const take = (shape: Props) => shape.width;
    return take;
}
}
"#,
        true,
        |analysis| {
            assert_eq!(analysis.closures.len(), 1);

            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [] as [(&str, bool, bool, bool); 0]
            );
        },
    );
}

#[test]
fn a_typeof_type_position_reference_is_not_a_capture() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    const shape = { width: 1 };
    const clone = (other: typeof shape): typeof shape => other;
    return clone;
}
}
"#,
        true,
        |analysis| {
            assert_eq!(analysis.closures.len(), 1);

            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [] as [(&str, bool, bool, bool); 0]
            );
        },
    );
}

#[test]
fn a_jsx_component_name_at_module_level_is_not_a_capture() {
    method_analysis(
        r#"
const TodoItem = (props: { id: string }) => null;

class Widget extends AntiHookComponent {
render() {
    return [1].map((id) => <TodoItem id={id}/>);
}
}
"#,
        true,
        |analysis| {
            assert_eq!(analysis.closures.len(), 1);

            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [] as [(&str, bool, bool, bool); 0]
            );
        },
    );
}

#[test]
fn a_jsx_component_name_declared_in_the_member_is_a_value_capture() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    const Row = this.makeRow;
    return () => <Row/>;
}
}
"#,
        true,
        |analysis| {
            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [("Row", true, false, false)]
            );
        },
    );
}

#[test]
fn an_object_shorthand_property_is_a_value_capture() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render(props: { carburetor: number }) {
    const carburetor = props.carburetor;
    return [1].map((id) => ({ id, carburetor }));
}
}
"#,
        true,
        |analysis| {
            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [("carburetor", false, false, false)]
            );
        },
    );
}

#[test]
fn an_assignment_inside_the_closure_marks_the_capture_written() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    let count = 0;
    const set = () => {
        count = count + 1;
    };
    return [set, count];
}
}
"#,
        true,
        |analysis| {
            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [("count", false, true, true)]
            );
        },
    );
}

#[test]
fn a_compound_assignment_marks_the_capture_written() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    let total = 0;
    let count = 0;
    const add = () => {
        total += count;
    };
    return [add];
}
}
"#,
        true,
        |analysis| {
            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [("total", false, true, true), ("count", false, false, false)]
            );
        },
    );
}

#[test]
fn an_increment_marks_the_capture_written() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    let first = 0;
    const bump = () => first++;
    return [bump];
}
}
"#,
        true,
        |analysis| {
            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [("first", false, true, true)]
            );
        },
    );
}

#[test]
fn a_destructuring_assignment_marks_the_capture_written() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    let count = 0;
    let pair = { value: 0 };
    const spread = () => ({ count } = pair);
    return [spread];
}
}
"#,
        true,
        |analysis| {
            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [("count", false, true, true), ("pair", false, false, false)]
            );
        },
    );
}

#[test]
fn a_write_later_in_the_member_marks_the_capture_written_after_init() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    let later = 1;
    const read = () => later;
    later = 2;
    return read;
}
}
"#,
        true,
        |analysis| {
            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [("later", false, false, true)]
            );
        },
    );
}

#[test]
fn a_const_local_chained_off_this_is_this_derived() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    const current = this.state.items;
    return [1].map(() => current.length);
}
}
"#,
        true,
        |analysis| {
            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [("current", true, false, false)]
            );
        },
    );
}

#[test]
fn a_cast_still_leaves_the_chain_this_derived() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    const current = this.props as { id: number };
    return [1].map(() => current.id);
}
}
"#,
        true,
        |analysis| {
            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [("current", true, false, false)]
            );
        },
    );
}

#[test]
fn a_destructured_this_chain_is_this_derived_for_each_plain_property() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    const { carburetor, id: key } = this.props as { carburetor: number; id: number };
    return [1].map(() => carburetor + key);
}
}
"#,
        true,
        |analysis| {
            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [
                    ("carburetor", true, false, false),
                    ("key", true, false, false)
                ]
            );
        },
    );
}

#[test]
fn a_rest_property_of_a_this_chain_is_not_this_derived() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    const { id, ...others } = this.props as Record<string, number>;
    return [1].map(() => id + others.x);
}
}
"#,
        true,
        |analysis| {
            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [("id", true, false, false), ("others", false, false, false)]
            );
        },
    );
}

#[test]
fn a_computed_member_off_this_is_not_this_derived() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    const field = "width";
    const picked = this.props[field];
    return [1].map(() => picked);
}
}
"#,
        true,
        |analysis| {
            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [("picked", false, false, false)]
            );
        },
    );
}

#[test]
fn a_call_off_this_is_not_this_derived() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    const current = this.getData();
    return [1].map(() => current);
}
}
"#,
        true,
        |analysis| {
            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [("current", false, false, false)]
            );
        },
    );
}

#[test]
fn a_reassigned_let_off_this_is_not_this_derived() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    let current = this.props;
    current = {} as { id: number };
    return [1].map(() => current);
}
}
"#,
        true,
        |analysis| {
            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [("current", false, false, true)]
            );
        },
    );
}

#[test]
fn a_never_reassigned_let_off_this_is_still_not_this_derived() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    let current = this.props;
    return [1].map(() => current);
}
}
"#,
        true,
        |analysis| {
            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [("current", false, false, false)]
            );
        },
    );
}

#[test]
fn an_optional_chain_off_this_is_not_this_derived() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    const maybe = this.props?.extra;
    return [1].map(() => maybe);
}
}
"#,
        true,
        |analysis| {
            assert_eq!(
                captures_digest(&analysis.closures[0]),
                [("maybe", false, false, false)]
            );
        },
    );
}
