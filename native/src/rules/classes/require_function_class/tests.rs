use std::path::Path;

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

use super::check_with_index;
use crate::config::Config;
use crate::rules::classes::css::Project;
use crate::rules::classes::testing::{CONFIG, REFERENCE};
use crate::Source;

/// Runs the rule over a TSX snippet against the reference stylesheet's index.
fn diagnose(text: &str) -> Vec<(usize, usize, String)> {
    let config = Config::from_json(CONFIG).unwrap();
    let project = Project::from_texts(&config, &[("styles/reference.css", REFERENCE)]);
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();
    assert!(parsed.diagnostics.is_empty(), "{:?}", parsed.diagnostics);
    let source = Source::new(Path::new("fixture.tsx"), text);

    check_with_index(&parsed.program, &source, Some(&project.index))
        .into_iter()
        .map(|diagnostic| (diagnostic.line, diagnostic.column, diagnostic.message))
        .collect()
}

#[test]
fn one_function_written_literally_is_clean() {
    let text = r#"
const a = <button className="submit-button">Save</button>;
const b = <button className={"cancel-button"}>Cancel</button>;
const c = <div className={`user-card`} data-state="busy" />;
const d = <button className={danger ? "submit-button" : "cancel-button"} />;
const e = <div className={open ? ("user-card") : undefined} />;
const f = <div className={null} />;
const g = <div className />;
"#;

    assert!(diagnose(text).is_empty(), "{:?}", diagnose(text));
}

#[test]
fn utilities_lower_floors_and_unknown_names_are_reported() {
    let text = r#"
const a = <div className="px-4" />;
const b = <div className="hover:pattern-button" />;
const c = <div className="pattern-button" />;
const d = <div className="tone-accent-solid" />;
const e = <div className="shape-control" />;
const f = <div className="mystery-box" />;
"#;
    let findings = diagnose(text);

    assert_eq!(
        findings
            .iter()
            .map(|(line, _, _)| *line)
            .collect::<Vec<_>>(),
        [2, 3, 4, 5, 6, 7]
    );
    assert_eq!(findings[0].1, 27);
    assert!(
        findings[0].2.contains("px-4 is a Tailwind utility"),
        "{findings:?}"
    );
    assert!(findings[1].2.contains("Tailwind utility"), "{findings:?}");
    assert!(
        findings[2].2.contains("pattern-button is a Pattern"),
        "{findings:?}"
    );
    assert!(
        findings[3].2.contains("tone-accent-solid is a Tone"),
        "{findings:?}"
    );
    assert!(
        findings[4].2.contains("shape-control is a Trait"),
        "{findings:?}"
    );
    assert!(
        findings[5]
            .2
            .contains("not a Function the configured CSS defines"),
        "{findings:?}"
    );
}

#[test]
fn several_classes_and_empty_class_names_are_reported() {
    let text = r#"
const a = <div className="user-card  px-4 mt-2" />;
const b = <div className="" />;
"#;
    let findings = diagnose(text);

    assert_eq!(
        findings
            .iter()
            .map(|(line, column, _)| (*line, *column))
            .collect::<Vec<_>>(),
        [(2, 38), (3, 27)]
    );
    assert!(findings[0].2.contains("holds 3 classes"), "{findings:?}");
    assert!(findings[1].2.contains("className is empty"), "{findings:?}");
}

#[test]
fn class_names_built_at_run_time_are_reported() {
    let text = r#"
const a = <div className={`user-card ${extra}`} />;
const b = <div className={clsx("user-card", busy && "busy")} />;
const c = <div className={["user-card"].join(" ")} />;
const d = <div className={styles} />;
const e = <div className={busy && "user-card"} />;
const f = <div className={danger ? "submit-button" : name} />;
"#;
    let findings = diagnose(text);

    assert_eq!(
        findings
            .iter()
            .map(|(line, _, _)| *line)
            .collect::<Vec<_>>(),
        [2, 3, 4, 5, 6, 7]
    );
    assert!(findings
        .iter()
        .all(|(_, _, message)| message.contains("one Function written as a string literal")));
}

#[test]
fn other_attributes_and_spread_props_are_not_checked() {
    let text = r#"
const a = <div class="px-4" data-class="px-4" {...props} />;
const b = <svg><path className="user-card" /></svg>;
"#;

    assert!(diagnose(text).is_empty());
}

#[test]
fn without_an_index_nothing_is_reported() {
    let text = r#"const a = <div className="px-4" />;"#;
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();
    let source = Source::new(Path::new("fixture.tsx"), text);

    assert!(check_with_index(&parsed.program, &source, None).is_empty());
}

#[test]
fn literal_spread_objects_create_element_and_class_name_props_are_checked() {
    let text = r#"
const a = <div {...{className: "px-4"}} />;
const b = React.createElement("div", {className: "tone-accent-solid"});
const c = createElement("div", {id: "x", className: "user-card"});
const d = jsx("div", {className: "px-4 mt-2"});
const e = <Field inputClassName="px-4" labelClassName="user-card" />;
const f = <div {...{"className": `submit-button`}} />;
"#;
    let findings = diagnose(text);

    assert_eq!(
        findings.iter().map(|(line, _, _)| *line).collect::<Vec<_>>(),
        [2, 3, 5, 6]
    );
    assert!(findings[0].2.contains("px-4 is a Tailwind utility"), "{findings:?}");
    assert!(findings[1].2.contains("tone-accent-solid is a Tone"), "{findings:?}");
    assert!(findings[2].2.contains("holds 2 classes"), "{findings:?}");
    assert!(findings[3].2.contains("px-4 is a Tailwind utility"), "{findings:?}");
}

#[test]
fn props_objects_built_elsewhere_and_other_calls_are_not_checked() {
    let text = r#"
const props = {className: "px-4"};
const a = <div {...props} />;
const b = React.createElement("div", props);
const c = format("div", {className: "px-4"});
const d = <div ClassName="px-4" />;
"#;

    assert!(diagnose(text).is_empty(), "{:?}", diagnose(text));
}
