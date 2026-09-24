use super::*;

#[test]
fn a_closure_inside_an_arrow_class_field_is_analyzed_but_the_field_is_the_root() {
    field_analysis(
        r#"
class Widget extends AntiHookComponent {
onClick = () => {
    const inner = () => this.handle();
    return inner;
};
}
"#,
        false,
        |analysis| {
            assert_eq!(analysis.closures.len(), 1);
            assert!(analysis.closures[0].class_dependency);
            assert!(analysis.class_dependency);
        },
    );
}

#[test]
fn a_closure_inside_a_function_class_field_is_analyzed_but_the_field_is_the_root() {
    field_analysis(
        r#"
class Widget extends AntiHookComponent {
onClick = function () {
    const inner = () => this.handle();
    return inner;
};
}
"#,
        false,
        |analysis| {
            assert_eq!(analysis.closures.len(), 1);
            assert!(analysis.closures[0].class_dependency);
        },
    );
}

#[test]
fn a_closure_in_a_non_function_class_field_initializer_is_not_analyzed() {
    field_analysis(
        r#"
class Widget extends AntiHookComponent {
handlers = { onClick: () => this.handle() };
}
"#,
        false,
        |analysis| {
            assert!(analysis.closures.is_empty());
            assert!(!analysis.class_dependency);
        },
    );
}

#[test]
fn a_closure_assigned_to_this_is_excluded() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
constructor() {
    this.onClick = () => this.handle();
}
}
"#,
        false,
        |analysis| assert_eq!(analysis.closures.len(), 0),
    );
}

#[test]
fn a_function_expression_using_this_is_excluded() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    const handler = function () { return this.value; };
    return handler;
}
}
"#,
        true,
        |analysis| assert_eq!(analysis.closures.len(), 0),
    );
}

#[test]
fn a_function_expression_using_arguments_is_excluded() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    const handler = function () { return arguments.length; };
    return handler;
}
}
"#,
        true,
        |analysis| assert_eq!(analysis.closures.len(), 0),
    );
}

#[test]
fn a_function_expression_using_new_target_is_excluded() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    const handler = function () { return new.target; };
    return handler;
}
}
"#,
        true,
        |analysis| assert_eq!(analysis.closures.len(), 0),
    );
}

#[test]
fn an_iife_is_excluded() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    const value = (() => this.compute())();
    return value;
}
}
"#,
        true,
        |analysis| assert_eq!(analysis.closures.len(), 0),
    );
}

#[test]
fn this_inside_a_nested_plain_function_still_marks_the_member_class_dependent() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
method() {
    const handler = function () { return this.value; };
    return handler;
}
}
"#,
        false,
        |analysis| assert!(analysis.class_dependency),
    );
}

#[test]
fn super_marks_the_member_class_dependent() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
method() {
    return super.render();
}
}
"#,
        false,
        |analysis| assert!(analysis.class_dependency),
    );
}

#[test]
fn a_private_field_read_marks_the_member_class_dependent() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
#secret = 1;
method() {
    return this.#secret;
}
}
"#,
        false,
        |analysis| assert!(analysis.class_dependency),
    );
}

#[test]
fn a_private_in_check_marks_the_member_class_dependent() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
#secret = 1;
method() {
    return #secret in this;
}
}
"#,
        false,
        |analysis| assert!(analysis.class_dependency),
    );
}

#[test]
fn a_this_type_position_marks_the_member_class_dependent_without_a_this_value() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
method(other: this): void {
    void other;
}
}
"#,
        false,
        |analysis| assert!(analysis.class_dependency),
    );
}

#[test]
fn a_class_type_parameter_reference_marks_the_member_class_dependent() {
    method_analysis(
        r#"
class Widget<T> extends AntiHookComponent {
method(value: T): void {
    void value;
}
}
"#,
        false,
        |analysis| assert!(analysis.class_dependency),
    );
}

#[test]
fn a_method_type_parameter_shadows_the_class_type_parameter() {
    method_analysis(
        r#"
class Widget<T> extends AntiHookComponent {
method<T>(value: T): T {
    const helper = (item: T): T => item;
    return helper(value);
}
}
"#,
        false,
        |analysis| {
            assert!(!analysis.class_dependency);
            assert_eq!(analysis.closures.len(), 1);
            assert!(!analysis.closures[0].class_dependency);
        },
    );
}

#[test]
fn an_unrelated_type_reference_does_not_mark_the_member_class_dependent() {
    method_analysis(
        r#"
class Widget<T> extends AntiHookComponent {
method(value: number): void {
    void value;
}
}
"#,
        false,
        |analysis| assert!(!analysis.class_dependency),
    );
}

#[test]
fn a_closure_only_ever_called_is_a_direct_helper() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
method() {
    const helper = () => this.compute();
    return helper() + helper();
}
}
"#,
        false,
        |analysis| {
            assert!(matches!(
                analysis.closures[0].usage,
                Usage::DirectHelper("helper")
            ));
        },
    );
}

#[test]
fn a_closure_passed_somewhere_is_a_callback() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
method() {
    const helper = () => this.compute();
    return [1].map(helper);
}
}
"#,
        false,
        |analysis| {
            assert!(matches!(analysis.closures[0].usage, Usage::Callback));
        },
    );
}

#[test]
fn a_reassigned_let_closure_is_a_callback_even_when_only_called() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
method(flag) {
    let helper = () => this.compute();
    if (flag) {
        helper = null;
    }
    return helper();
}
}
"#,
        false,
        |analysis| {
            assert!(matches!(analysis.closures[0].usage, Usage::Callback));
        },
    );
}

#[test]
fn a_pure_forward_to_a_method_is_a_forwarder() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
method() {
    const forward = (a, b) => this.handle(a, b);
    return forward;
}
}
"#,
        false,
        |analysis| {
            let forwarder = analysis.closures[0]
                .forwarder
                .as_ref()
                .expect("must forward");

            assert_eq!(forwarder.method, "handle");
        },
    );
}

#[test]
fn an_extra_argument_is_not_a_forwarder() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
method() {
    const notForward = (a, b) => this.handle(a, b, 1);
    return notForward;
}
}
"#,
        false,
        |analysis| assert!(analysis.closures[0].forwarder.is_none()),
    );
}

#[test]
fn a_reordered_argument_is_not_a_forwarder() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
method() {
    const notForward = (a, b) => this.handle(b, a);
    return notForward;
}
}
"#,
        false,
        |analysis| assert!(analysis.closures[0].forwarder.is_none()),
    );
}

#[test]
fn a_rest_parameter_forward_is_not_a_forwarder() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
method() {
    const notForward = (...args) => this.handle(...args);
    return notForward;
}
}
"#,
        false,
        |analysis| assert!(analysis.closures[0].forwarder.is_none()),
    );
}

#[test]
fn a_synchronous_callback_in_render_executes_in_render() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    return this.items.map(item => this.renderItem(item));
}
}
"#,
        true,
        |analysis| assert!(analysis.closures[0].executes_in_render),
    );
}

#[test]
fn the_same_closure_outside_a_render_member_does_not_execute_in_render() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
method() {
    return this.items.map(item => this.renderItem(item));
}
}
"#,
        false,
        |analysis| assert!(!analysis.closures[0].executes_in_render),
    );
}

#[test]
fn a_closure_handed_to_settimeout_in_render_does_not_execute_in_render() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    setTimeout(() => this.recompute(), 0);
    return null;
}
}
"#,
        true,
        |analysis| assert!(!analysis.closures[0].executes_in_render),
    );
}
