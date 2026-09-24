use super::*;

#[test]
fn a_direct_component_base_is_a_component() {
    component_class(
        r#"class Widget extends AntiHookComponent { render() { return null; } }"#,
        "Widget",
        |component| assert!(component),
    );

    component_class(
        r#"class Widget extends ScopedAntiHookComponent { render() { return null; } }"#,
        "Widget",
        |component| assert!(component),
    );
}

#[test]
fn a_class_without_heritage_is_not_a_component() {
    component_class(
        r#"class Widget { render() { return null; } }"#,
        "Widget",
        |component| assert!(!component),
    );
}

#[test]
fn a_same_file_subclass_of_a_component_is_a_component() {
    let text = r#"
class MyBase extends AntiHookComponent {}

class Widget extends MyBase {}
"#;

    component_class(text, "Widget", |component| assert!(component));

    component_class(text, "MyBase", |component| assert!(component));
}

#[test]
fn a_three_level_same_file_chain_is_a_component() {
    component_class(
        r#"
class Ground extends AntiHookComponent {}

class Middle extends Ground {}

class Top extends Middle {}
"#,
        "Top",
        |component| assert!(component),
    );
}

#[test]
fn a_subclass_of_an_imported_base_is_not_a_component() {
    component_class(
        r#"
import { External } from "./external";

class Widget extends External {
render() {
    return null;
}
}
"#,
        "Widget",
        |component| assert!(!component),
    );
}

#[test]
fn a_same_file_heritage_cycle_terminates_as_not_a_component() {
    let cycle = r#"
class LoopA extends LoopB {}

class LoopB extends LoopA {}
"#;

    component_class(cycle, "LoopA", |component| assert!(!component));

    component_class(cycle, "LoopB", |component| assert!(!component));

    component_class(r#"class Ouro extends Ouro {}"#, "Ouro", |component| {
        assert!(!component)
    });
}

#[test]
fn a_store_class_and_its_subclass_are_not_components() {
    let text = r#"
class MyStore extends Carburetor {}

class SubStore extends MyStore {}
"#;

    component_class(text, "MyStore", |component| assert!(!component));

    component_class(text, "SubStore", |component| assert!(!component));
}

#[test]
fn a_prop_closure_on_a_component_element_is_excluded() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    return <Child onClick={() => this.handle()} />;
}
}
"#,
        true,
        |analysis| assert_eq!(analysis.closures.len(), 0),
    );
}

#[test]
fn a_prop_closure_on_a_qualified_component_element_is_excluded() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    return <UI.Button onClick={(() => this.handle()) as Callback} />;
}
}
"#,
        true,
        |analysis| assert_eq!(analysis.closures.len(), 0),
    );
}

#[test]
fn a_prop_closure_on_a_dom_element_is_not_excluded() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    return <div onClick={() => this.handle()} />;
}
}
"#,
        true,
        |analysis| assert_eq!(analysis.closures.len(), 1),
    );
}

#[test]
fn a_library_callback_argument_is_excluded() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
componentDidMount() {
    useEffect(() => this.subscribe());
}
}
"#,
        false,
        |analysis| assert_eq!(analysis.closures.len(), 0),
    );
}

#[test]
fn a_wrapped_library_callback_argument_is_excluded() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
componentDidMount() {
    useEffect((() => this.subscribe()) as EffectCallback);
}
}
"#,
        false,
        |analysis| assert_eq!(analysis.closures.len(), 0),
    );
}

#[test]
fn a_wrapped_callback_to_an_unrelated_api_is_not_excluded() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
componentDidMount() {
    runLater((() => this.subscribe()) as Callback);
}
}
"#,
        false,
        |analysis| assert_eq!(analysis.closures.len(), 1),
    );
}

#[test]
fn a_render_closure_reading_tracked_data_stays_in_render() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
render() {
    return this.items.map(item => this.getData(item));
}
}
"#,
        true,
        |analysis| assert_eq!(analysis.closures.len(), 0),
    );
}

#[test]
fn the_same_tracked_call_outside_render_is_not_excluded() {
    method_analysis(
        r#"
class Widget extends AntiHookComponent {
componentDidMount() {
    return this.items.map(item => this.getData(item));
}
}
"#,
        false,
        |analysis| assert_eq!(analysis.closures.len(), 1),
    );
}
