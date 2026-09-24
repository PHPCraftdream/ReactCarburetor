use super::*;
use crate::rules::support::testing::{diagnose, lines};

fn reported(source: &str) -> Vec<Diagnostic> {
    diagnose(source, check)
}

#[test]
fn the_todo_app_shape_is_reported_on_every_render_with_its_this_derived_capture_named() {
    let source = r#"
const TodoItem = (props: { key: string; carburetor: number; id: number }) => null;

class TodoApp extends AntiHookComponent {
    render() {
        const { carburetor } = this.props as { carburetor: number };

        return this.orderIds.map((id) => <TodoItem key={id} carburetor={carburetor} id={id}/>);
    }
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [8]);

    let message = &found[0].message;

    assert!(message.contains("rebuilt on every render"), "{message}");
    assert!(
        message.contains("reading `carburetor` from `this` inside it"),
        "{message}"
    );
    assert!(
        message.contains("@bind because it is handed over as a value"),
        "{message}"
    );
}

#[test]
fn a_plain_local_captured_by_a_callback_blocks_the_report() {
    let source = r#"
class Widget extends AntiHookComponent {
    render() {
        const suffix = "!";

        return <ul>{this.items.map((item) => <li key={item}>{suffix}</li>)}</ul>;
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn a_plain_local_captured_by_a_class_dependent_callback_is_never_passable() {
    // The plain local makes the capture impassable in a callback's usage; the `this.mark`
    // read only makes the closure class-dependent, so the passability gate is what blocks.
    let source = r#"
class Widget extends AntiHookComponent {
    render() {
        const suffix = "!";

        return <ul>{this.items.map((item) => <li key={item}>{suffix}{this.mark}</li>)}</ul>;
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn a_direct_helper_over_a_never_written_const_takes_it_as_a_parameter() {
    let source = r#"
class Widget extends AntiHookComponent {
    render() {
        const suffix = "!";

        const label = (name: string) => this.base + name + suffix;

        return label(this.title);
    }
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [6]);

    let message = &found[0].message;

    assert!(
        message.contains("rebuilt on every call of `render`"),
        "{message}"
    );
    assert!(
        message.contains("taking `suffix` as a parameter"),
        "{message}"
    );
    assert!(!message.contains("@bind"), "{message}");
}

#[test]
fn a_direct_helper_over_a_local_reassigned_later_is_not_reported() {
    let source = r#"
class Widget extends AntiHookComponent {
    method(flag: boolean) {
        let suffix = "!";
        const label = (name: string) => this.base + name + suffix;

        if (flag) {
            suffix = "?";
        }

        return label("done");
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn a_closure_that_writes_its_own_capture_is_not_reported() {
    let source = r#"
class Widget extends AntiHookComponent {
    method() {
        let count = 0;
        const bump = () => {
            count += 1;

            return this.show(count);
        };

        return bump();
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn a_pure_forwarder_gets_the_forwarder_message() {
    let source = r#"
class Widget extends AntiHookComponent {
    method() {
        const forward = (a: number, b: string) => this.handle(a, b);

        return this.transport(forward);
    }
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [4]);

    let message = &found[0].message;

    assert!(message.contains("forwarding to `this.handle`"), "{message}");
    assert!(message.contains("bound once with @bind"), "{message}");
    assert!(!message.contains("Declare it as a method"), "{message}");
}

#[test]
fn a_forwarder_with_a_plain_local_argument_is_not_reported() {
    let source = r#"
class Widget extends AntiHookComponent {
    method() {
        const item = this.pick();
        const forward = (a: number) => this.handle(item, a);

        return this.transport(forward);
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn a_closure_on_a_component_element_is_h21s_not_this_rules() {
    let source = r#"
class Widget extends AntiHookComponent {
    render() {
        return <Row onClick={() => this.handle()}/>;
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn a_dom_element_attribute_using_this_is_reported() {
    let source = r#"
class Widget extends AntiHookComponent {
    render() {
        return <button onClick={() => this.handle()}/>;
    }
}
"#;

    let found = reported(source);

    assert_eq!(lines(&found), [4]);

    let message = &found[0].message;

    assert!(message.contains("on every call of `render`"), "{message}");
    // `() => this.handle()` is the plan §5.5's first forwarder shape — zero parameters
    // forwarded to a `this.` call — so the advice is the forwarder one: pass the bound
    // method instead of building the wrapper.
    assert!(message.contains("on every call of `render`"), "{message}");
    assert!(message.contains("forwarding to `this.handle`"), "{message}");
    assert!(message.contains("bound once with @bind"), "{message}");
    assert!(!message.contains("Declare it as a method"), "{message}");
}

#[test]
fn library_callback_apis_keep_their_closures_where_they_sit() {
    let source = r#"
class Widget extends AntiHookComponent {
    componentDidMount() {
        useEffect(() => this.subscribe());
        update((draft) => this.touch(draft));
        transaction(() => this.commit());
        computed(() => this.read());
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn render_closures_calling_the_tracked_apis_are_not_reported() {
    let source = r#"
class Widget extends AntiHookComponent {
    render() {
        this.rows.forEach((row) => this.getData(row));

        return [1].map(() => this.useCarburetor());
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn a_tracked_call_outside_render_is_this_rules_report_to_make() {
    // The tracked-API exclusion is render-only by design: outside render, moving the call
    // cannot hide it from a rule that reads it today, so a class-dependent closure with
    // nothing but `this` inside is a normal candidate.
    let source = r#"
class Widget extends AntiHookComponent {
    list() {
        return [1].map(() => this.useCarburetor());
    }
}
"#;

    assert_eq!(lines(&reported(source)), [4]);
}

#[test]
fn a_nested_closure_in_an_arrow_class_field_is_reported() {
    let source = r#"
class Widget extends AntiHookComponent {
    onClick = () => {
        const inner = () => this.handle();

        return inner;
    };
}
"#;

    assert_eq!(lines(&reported(source)), [4]);
}

#[test]
fn a_closure_assigned_to_this_is_a_member_in_all_but_syntax() {
    let source = r#"
class Widget extends AntiHookComponent {
    constructor() {
        this.onClick = () => this.handle();
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn a_function_expression_using_this_has_a_this_of_its_own() {
    let source = r#"
class Widget extends AntiHookComponent {
    render() {
        const handler = function () {
            return this.value;
        };

        return handler;
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn an_arrow_using_arguments_cannot_be_passed_transparently() {
    let source = r#"
class Widget extends AntiHookComponent {
    render() {
        const handler = () => arguments.length;

        return handler;
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn a_nested_class_is_reported_once_as_its_own_class() {
    let source = r#"
class Outer extends AntiHookComponent {
    render() {
        return <button onClick={() => this.handle()}/>;
    }

    make() {
        return class Nested extends AntiHookComponent {
            render() {
                return <button onClick={() => this.click()}/>;
            }
        };
    }
}
"#;

    assert_eq!(lines(&reported(source)), [4, 10]);
}

#[test]
fn a_nested_component_inside_a_plain_class_is_still_the_only_one_reported() {
    let source = r#"
class Plain {
    make() {
        return class Nested extends AntiHookComponent {
            render() {
                return <button onClick={() => this.click()}/>;
            }
        };
    }
}
"#;

    assert_eq!(lines(&reported(source)), [6]);
}

#[test]
fn a_store_class_and_its_subclass_are_out_of_scope() {
    let source = r#"
class MyStore extends Carburetor {
    render() {
        return <button onClick={() => this.handle()}/>;
    }
}

class SubStore extends MyStore {
    render() {
        return <button onClick={() => this.handle()}/>;
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn a_same_file_subclass_of_a_component_subclass_is_a_component() {
    let source = r#"
class Ground extends AntiHookComponent {}

class Middle extends Ground {}

class Top extends Middle {
    render() {
        return <button onClick={() => this.handle()}/>;
    }
}
"#;

    assert_eq!(lines(&reported(source)), [8]);
}

#[test]
fn a_subclass_of_an_imported_base_is_outside_the_same_file_walk() {
    let source = r#"
import { External } from "./external";

class Widget extends External {
    render() {
        return <button onClick={() => this.handle()}/>;
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn a_same_file_subclass_render_stays_render_for_the_tracked_api_exclusion() {
    // `context.in_render` from the walk is direct-extends-only; without the rule widening it
    // to D6's scope, this closure would come back as a candidate — class-dependent, zero
    // captures — and the report would move a `getData` call out of render.
    let source = r#"
class Ground extends AntiHookComponent {}

class Top extends Ground {
    render() {
        return this.rows.map((row) => this.getData(row));
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}

#[test]
fn a_class_that_is_not_a_component_is_left_alone() {
    let source = r#"
class Plain {
    render() {
        return <button onClick={() => this.handle()}/>;
    }
}
"#;

    assert_eq!(lines(&reported(source)), [] as [usize; 0]);
}
