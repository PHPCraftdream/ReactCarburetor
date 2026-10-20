//! The parse/override tests for `Config`, split out of `mod.rs` for size.

mod options;

use super::*;
use serde_json::json;

#[test]
fn an_empty_object_is_pure_defaults() {
    let config = parse("{}").unwrap();

    assert_eq!(config, Config::default());
    assert_eq!(
        config.severity("carburetor/no-module-level-store"),
        Severity::Off
    );
    assert_eq!(config.severity("require-effect-deps"), Severity::Warn);
    assert_eq!(
        config.severity("carburetor/prefer-readonly-array-param"),
        Severity::Off
    );
    assert_eq!(
        config.severity("carburetor/no-async-effect"),
        Severity::Error
    );
}

#[test]
fn prefixed_and_bare_rule_keys_normalise_to_one_setting() {
    let prefixed = parse(r#"{"rules": {"carburetor/require-effect-deps": "error"}}"#).unwrap();
    let bare = parse(r#"{"rules": {"require-effect-deps": "error"}}"#).unwrap();

    assert_eq!(prefixed, bare);
    assert_eq!(
        prefixed.severity("carburetor/require-effect-deps"),
        Severity::Error
    );
}

#[test]
fn array_form_carries_options_verbatim() {
    let config =
        parse(r#"{"rules": {"require-effect-deps": ["warn", {"any": "options"}]}}"#).unwrap();

    let setting = &config.rules["require-effect-deps"];
    assert_eq!(setting.severity, Severity::Warn);
    assert_eq!(setting.options, Some(json!({ "any": "options" })));
}

#[test]
fn unknown_rules_and_bad_severities_are_rejected() {
    assert!(parse(r#"{"rules": {"carburetor/no-such-rule": "error"}}"#).is_err());
    assert!(parse(r#"{"rules": {"require-effect-deps": "fatal"}}"#).is_err());
    assert!(parse(r#"{"rules": {"require-effect-deps": ["warn"]}}"#).is_err());
    assert!(parse(r#"{"rules": {"require-effect-deps": ["warn", "strict"]}}"#).is_err());
}

#[test]
fn invalid_globs_are_rejected() {
    assert!(parse(r#"{"ignore": ["["]}"#).is_err());
    assert!(parse(r#"{"ignore": [""]}"#).is_err());
    assert!(parse(r#"{"ignore": [3]}"#).is_err());
    assert!(parse(r#"{"ignore": ["**/generated/**", "examples/legacy"]}"#).is_ok());
}

#[test]
fn unknown_top_level_keys_are_rejected() {
    assert!(parse(r#"{"ruls": {}}"#).is_err());
}

#[test]
fn structurally_broken_files_are_rejected() {
    assert!(parse("not json").is_err());
    assert!(parse("[]").is_err());
    assert!(parse(r#"{"rules": "warn"}"#).is_err());
}

#[test]
fn ignore_patterns_survive_parsing() {
    let config = parse(r#"{"ignore": ["**/generated/**", "examples/legacy"]}"#).unwrap();

    assert_eq!(config.ignores(), ["**/generated/**", "examples/legacy"]);
}
