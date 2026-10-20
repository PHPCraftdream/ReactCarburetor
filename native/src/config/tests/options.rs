//! The per-rule options tests, split out of `tests.rs` for size.

use super::{json, parse};
use crate::config::{ModuleFunctionScope, Severity};

#[test]
fn module_function_scope_defaults_to_all_and_parses_both_spellings() {
    assert_eq!(
        parse("{}").unwrap().module_function_scope(),
        ModuleFunctionScope::All
    );

    let classes =
        parse(r#"{"rules": {"require-module-function": ["warn", {"scope": "classes"}]}}"#).unwrap();

    assert_eq!(
        classes.module_function_scope(),
        ModuleFunctionScope::Classes
    );
    assert_eq!(classes.severity("require-module-function"), Severity::Warn);
}

#[test]
fn module_function_scope_rejects_unknown_values_and_keys() {
    assert!(
        parse(r#"{"rules": {"require-module-function": ["warn", {"scope": "bogus"}]}}"#).is_err()
    );
    assert!(parse(r#"{"rules": {"require-module-function": ["warn", {"unknown": 1}]}}"#).is_err());
    assert!(parse(r#"{"rules": {"require-module-function": ["warn", "classes"]}}"#).is_err());
}

#[test]
fn another_rules_options_stay_verbatim() {
    let config =
        parse(r#"{"rules": {"require-effect-deps": ["warn", {"any": {"nested": 1}}]}}"#).unwrap();

    assert_eq!(
        config.rules["require-effect-deps"].options,
        Some(json!({"any": {"nested": 1}}))
    );
}

#[test]
fn command_line_overrides_win_and_validate() {
    let mut config = parse("{}").unwrap();

    config
        .override_rule("require-effect-deps", Severity::Error)
        .unwrap();
    assert_eq!(config.severity("require-effect-deps"), Severity::Error);

    config
        .override_rule("carburetor/no-module-level-store", Severity::Warn)
        .unwrap();
    assert_eq!(config.severity("no-module-level-store"), Severity::Warn);

    assert!(config
        .override_rule("no-such-rule", Severity::Error)
        .is_err());
}
