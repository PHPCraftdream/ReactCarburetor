//! The `classes` section: defaults, overrides, and every validation error.

use super::super::classes::CLASS_RULES;
use super::*;
use crate::rules::classes::css::bricks::KNOWN_PROPERTIES;
use crate::rules::classes::css::settings::{colour_lists_agree, wildcard_match};

fn error(text: &str) -> String {
    match parse(text) {
        Ok(_) => panic!("expected an error for {text}"),
        Err(error) => error.to_string(),
    }
}

#[test]
fn without_the_section_every_class_rule_is_off() {
    let config = parse("{}").unwrap();

    assert!(config.classes().is_none());
    for rule in CLASS_RULES {
        assert_eq!(config.severity(rule), Severity::Off, "{rule}");
        assert!(
            DEFAULT_SEVERITIES.iter().any(|(known, _)| *known == rule),
            "{rule} must be a known rule"
        );
    }
}

#[test]
fn with_the_section_every_class_rule_defaults_to_error_and_can_be_tuned() {
    let config = parse(
        r#"{"classes": {"css": ["src/**/*.css"]}, "rules": {"carburetor/no-duplicate-class": "warn"}}"#,
    )
    .unwrap();

    assert_eq!(config.severity("valid-tone-class"), Severity::Error);
    assert_eq!(
        config.severity("carburetor/require-function-class"),
        Severity::Error
    );
    assert_eq!(config.severity("no-duplicate-class"), Severity::Warn);
}

#[test]
fn omitted_keys_take_the_documented_defaults() {
    let config = parse(r#"{"classes": {"css": ["src/**/*.css"]}}"#).unwrap();
    let classes = config.classes().unwrap();

    assert_eq!(classes.css, ["src/**/*.css"]);
    assert_eq!(classes.theme_selectors, [":root", "[data-theme]"]);
    assert_eq!(
        classes.families,
        ["neutral", "accent", "danger", "success", "warning"]
    );
    assert_eq!(
        classes.slots,
        ["fill", "on-fill", "wash", "ink", "ink-subtle", "edge"]
    );
    assert_eq!(classes.states, ["hover", "active"]);
    assert_eq!(
        classes.surface_levels,
        ["page", "raised", "sunken", "overlay"]
    );
    assert_eq!(classes.delivery("solid").unwrap(), ["fill", "on-fill"]);
    assert_eq!(classes.delivery("subtle").unwrap(), ["ink-subtle"]);
    let kinds: Vec<&str> = classes
        .trait_kinds
        .iter()
        .map(|(kind, _)| kind.as_str())
        .collect();
    assert_eq!(
        kinds,
        ["shape", "type", "layout", "motion", "focus", "effect", "behavior"]
    );
    assert!(classes.is_css("src/styles/app.css"));
    assert!(!classes.is_css("vendor/app.css"));
    assert!(classes.is_reserved("shape"));
    assert!(classes.is_reserved("tone"));
    assert!(!classes.is_reserved("submit"));
}

#[test]
fn every_known_property_has_exactly_one_default_owner_and_no_colour_has_any() {
    let config = parse(r#"{"classes": {"css": ["*.css"]}}"#).unwrap();
    let classes = config.classes().unwrap();

    for property in KNOWN_PROPERTIES {
        assert_eq!(classes.owners(property).len(), 1, "{property}");
    }
    for colour in [
        "color",
        "background-color",
        "border-color",
        "outline-color",
        "fill",
    ] {
        assert!(classes.owners(colour).is_empty(), "{colour}");
    }
    assert!(colour_lists_agree());
}

#[test]
fn partial_overrides_replace_only_their_key() {
    let config = parse(
        r#"{"classes": {"css": ["a.css"], "families": ["brand"], "traitKinds": {"box": ["padding*"]}}}"#,
    )
    .unwrap();
    let classes = config.classes().unwrap();

    assert_eq!(classes.families, ["brand"]);
    assert_eq!(classes.slots.len(), 6);
    assert_eq!(classes.trait_kinds.len(), 1);
    assert_eq!(classes.owners("padding-top"), ["box"]);
    assert!(classes.owners("margin").is_empty());
}

#[test]
fn validation_errors_name_the_problem() {
    let cases: &[(&str, &str)] = &[
        (r#"{"classes": {}}"#, "\"classes.css\" is required"),
        (
            r#"{"classes": {"css": []}}"#,
            "\"classes.css\" must not be empty",
        ),
        (
            r#"{"classes": {"css": ["a/{b"]}}"#,
            "not a valid glob pattern",
        ),
        (r#"{"classes": {"css": [""]}}"#, "entries must not be empty"),
        (
            r#"{"classes": {"css": ["*.css"], "colours": []}}"#,
            "unknown key \"classes.colours\"",
        ),
        (
            r#"{"classes": {"css": ["*.css"], "families": ["Accent"]}}"#,
            "lowercase words",
        ),
        (
            r#"{"classes": {"css": ["*.css"], "families": ["a", "a"]}}"#,
            "lists \"a\" twice",
        ),
        (
            r#"{"classes": {"css": ["*.css"], "families": ["surface"]}}"#,
            "collides with the surface family",
        ),
        (
            r#"{"classes": {"css": ["*.css"], "states": []}}"#,
            "\"classes.states\" must not be empty",
        ),
        (
            r#"{"classes": {"css": ["*.css"], "deliveries": {"solid": ["glow"]}}}"#,
            "uses slot \"glow\", which \"classes.slots\" does not list",
        ),
        (
            r#"{"classes": {"css": ["*.css"], "traitKinds": {"a": ["padding*"], "b": ["padding-top"]}}}"#,
            "padding-top is owned by both a and b",
        ),
        (
            r#"{"classes": {"css": ["*.css"], "traitKinds": {"paint": ["border-*"]}}}"#,
            "covers the colour property border-color",
        ),
        (
            r#"{"classes": {"css": ["*.css"], "traitKinds": {"tone": ["width"]}}}"#,
            "kind \"tone\" is a reserved floor word",
        ),
        (
            r#"{"classes": {"css": ["*.css"], "traitKinds": {"shape": ["Width"]}}}"#,
            "must be a property name",
        ),
        (
            r#"{"classes": {"css": ["*.css"], "themeSelectors": ["html body"]}}"#,
            "must be a pseudo-class",
        ),
        (r#"{"classes": ["*.css"]}"#, "\"classes\" must be an object"),
    ];

    for (text, expected) in cases {
        let message = error(text);
        assert!(message.contains(expected), "{text}: {message}");
    }
}

#[test]
fn a_class_rule_switched_on_without_the_section_is_an_error() {
    assert!(error(r#"{"rules": {"valid-tone-class": "error"}}"#)
        .contains("valid-tone-class is on but the config has no \"classes\" section"));
    assert!(error(
        r#"{"overrides": [{"files": ["*.css"], "rules": {"require-function-class": "warn"}}]}"#
    )
    .contains("require-function-class is on"));
    assert!(parse(r#"{"rules": {"valid-tone-class": "off"}}"#).is_ok());

    // The command line may switch a class rule on without the section: the bridge does exactly
    // that for every rule, and the rule then has no stylesheet to read.
    let mut config = parse("{}").unwrap();
    assert!(config
        .override_rule("carburetor/no-duplicate-class", Severity::Error)
        .is_ok());
    assert!(config.class_index().is_none());
}

#[test]
fn the_root_key_moves_the_root_relative_to_the_config_file() {
    let config = parse(r#"{"root": "project"}"#).unwrap();
    assert!(config.root().ends_with("project"));

    let message = error(r#"{"root": ""}"#);
    assert!(
        message.contains("\"root\" must be a non-empty path"),
        "{message}"
    );
    assert!(error(r#"{"root": 1}"#).contains("\"root\" must be"));
}

#[test]
fn wildcards_match_any_run_including_none() {
    assert!(wildcard_match("padding*", "padding"));
    assert!(wildcard_match("padding*", "padding-inline-start"));
    assert!(wildcard_match("border-*width", "border-width"));
    assert!(wildcard_match("border-*width", "border-top-width"));
    assert!(!wildcard_match("border-*width", "border-style"));
    assert!(wildcard_match("*", ""));
    assert!(!wildcard_match("min-*", "max-width"));
    assert!(wildcard_match("a*b*c", "a-x-b-y-c"));
    assert!(!wildcard_match("a*b*c", "a-x-c-y-b"));
}
