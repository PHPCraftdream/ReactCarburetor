//! File override parsing, matching, and mechanism-counter tests.

use crate::config::{
    override_match_count, parse, reset_override_match_count, Config, ConfigError, Severity,
};
use crate::source::analyze;
use std::path::Path;

#[test]
fn override_validation_rejects_each_malformed_shape() {
    let malformed = [
        r#"{"overrides":{}}"#,
        r#"{"overrides":[null]}"#,
        r#"{"overrides":[{"files":[],"rules":{}}]}"#,
        r#"{"overrides":[{"files":["["],"rules":{}}]}"#,
        r#"{"overrides":[{"files":[2],"rules":{}}]}"#,
        r#"{"overrides":[{"files":["*.ts"]}]}"#,
        r#"{"overrides":[{"files":["*.ts"],"rules":[]}] }"#,
        r#"{"overrides":[{"files":["*.ts"],"rules":{"unknown":"off"}}]}"#,
        r#"{"overrides":[{"files":["*.ts"],"rules":{"require-effect-deps":"bad"}}]}"#,
        r#"{"overrides":[{"files":["*.ts"],"rules":{"require-effect-deps":["warn"]}}]}"#,
        r#"{"overrides":[{"files":["*.ts"],"rules":{"require-effect-deps":["warn",null]}}]}"#,
        r#"{"overrides":[{"files":["*.ts"],"rules":{"require-module-function":["warn",{"scope":"invalid"}]}}]}"#,
        r#"{"overrides":[{"files":["*.ts"],"rules":{},"extra":true}]}"#,
    ];
    for text in malformed {
        assert!(parse(text).is_err(), "accepted malformed override {text}");
    }
}

#[test]
fn last_matching_entry_wins_and_rooted_globs_do_not_match_outside_paths() {
    let mut config = parse(concat!(
        r#"{"overrides":[{"files":["e2e/**"],"rules":{"require-effect-deps":"error"}},"#,
        r#"{"files":["e2e/**"],"rules":{"require-effect-deps":"off"}}]}"#,
    ))
    .unwrap();
    config.root = std::env::current_dir().unwrap();
    let root = config.root.clone();
    let inside = root.join("e2e/a.ts");
    assert_eq!(
        config
            .overrides_for(&inside)
            .severity("require-effect-deps"),
        Severity::Off
    );
    let cwd_relative = root
        .strip_prefix(std::env::current_dir().unwrap())
        .unwrap()
        .join("e2e/a.ts");
    assert_eq!(
        config
            .overrides_for(&cwd_relative)
            .severity("require-effect-deps"),
        Severity::Off
    );
    let outside = std::env::temp_dir().join("outside/e2e/a.ts");
    assert_eq!(
        config
            .overrides_for(&outside)
            .severity("require-effect-deps"),
        Severity::Warn
    );
}

#[test]
fn windows_separator_and_options_are_preserved() {
    let config = parse(concat!(
        r#"{"overrides":[{"files":["**/*.test.ts"],"rules":{"#,
        r#""carburetor/require-module-function":["off",{"scope":"classes"}]}}]}"#,
    ))
    .unwrap();
    let effective = config.overrides_for(Path::new(r"src\\foo.test.ts"));
    assert_eq!(effective.severity("require-module-function"), Severity::Off);
    assert_eq!(
        effective.module_function_scope(),
        crate::config::ModuleFunctionScope::Classes
    );
}

#[test]
fn override_patterns_are_relative_to_config_root_for_relative_and_absolute_inputs() {
    let mut config =
        parse(r#"{"overrides":[{"files":["e2e/**"],"rules":{"require-effect-deps":"off"}}]}"#)
            .unwrap();
    config.root = std::env::current_dir().unwrap();
    let absolute = config.root.join("e2e/test.ts");
    assert_eq!(
        config
            .overrides_for(&absolute)
            .severity("require-effect-deps"),
        Severity::Off
    );
    let relative = config
        .root
        .strip_prefix(std::env::current_dir().unwrap())
        .unwrap()
        .join("e2e/test.ts");
    assert_eq!(
        config
            .overrides_for(&relative)
            .severity("require-effect-deps"),
        Severity::Off
    );
    assert_eq!(
        config
            .overrides_for(&std::env::temp_dir().join("outside/e2e/test.ts"))
            .severity("require-effect-deps"),
        Severity::Warn
    );
    let windows = absolute
        .to_string_lossy()
        .replace('/', &char::from(92).to_string());
    assert_eq!(
        config
            .overrides_for(Path::new(&windows))
            .severity("require-effect-deps"),
        Severity::Off
    );
}

#[test]
fn cwd_relative_input_below_nested_config_root_is_not_doubled() {
    let cwd = std::env::current_dir().unwrap();
    let root = cwd.join("sub");
    let mut config =
        parse(r#"{"overrides":[{"files":["e2e/**"],"rules":{"require-effect-deps":"off"}}]}"#)
            .unwrap();
    config.root = root;
    assert_eq!(
        config
            .overrides_for(Path::new("sub/e2e/a.ts"))
            .severity("require-effect-deps"),
        Severity::Off
    );
    assert_eq!(
        config
            .overrides_for(Path::new("sub/sub/e2e/a.ts"))
            .severity("require-effect-deps"),
        Severity::Warn
    );
}

#[test]
fn override_match_count_is_per_file_not_per_ast_node() {
    let config = parse(concat!(
        r#"{"overrides":[{"files":["**/*.ts"],"rules":{"require-effect-deps":"off"}},{"files":["never/**"],"rules":{"#,
        r#""no-async-effect":"off"}}]}"#,
    )).unwrap();
    let path = Path::new("many.ts");
    let source = (0..250)
        .map(|i| format!("const value{i} = () => {{ return {i}; }};\n"))
        .collect::<String>();
    reset_override_match_count();
    let effective = config.overrides_for(path);
    assert_eq!(override_match_count(), 2);
    assert!(analyze(path, &source, &effective, false).is_some());
    assert_eq!(override_match_count(), 2);

    let no_overrides = parse("{}").unwrap();
    reset_override_match_count();
    let effective = no_overrides.overrides_for(path);
    assert!(analyze(path, &source, &effective, false).is_some());
    assert_eq!(override_match_count(), 0);

    let positive = parse(
        r#"{"overrides":[{"files":["**/*.ts"],"rules":{"require-module-function":"error"}}]}"#,
    )
    .unwrap();
    reset_override_match_count();
    let effective = positive.overrides_for(path);
    assert_eq!(override_match_count(), 1);
    let diagnostics = analyze(
        path,
        "export function outer(xs: number[]) { return xs.map(x => x + 1); }",
        &effective,
        false,
    )
    .unwrap();
    assert!(
        !diagnostics.is_empty(),
        "the positive control must produce a normal rule diagnostic"
    );
}

#[test]
fn explicit_config_load_keeps_its_directory_as_root_and_errors_keep_config_path() {
    let dir = std::env::temp_dir().join(format!("carburetor-config-root-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let config_file = dir.join("config.json");
    std::fs::write(
        &config_file,
        r#"{"overrides":[{"files":["e2e/**"],"rules":{"require-effect-deps":"off"}}]}"#,
    )
    .unwrap();
    let config = Config::load(Some(&config_file)).unwrap();
    let absolute = dir.join("e2e/nonexistent.ts");
    assert_eq!(
        config
            .overrides_for(&absolute)
            .severity("require-effect-deps"),
        Severity::Off
    );
    assert_eq!(
        config
            .overrides_for(Path::new("outside/e2e/nonexistent.ts"))
            .severity("require-effect-deps"),
        Severity::Warn
    );
    let malformed = dir.join("bad.json");
    std::fs::write(&malformed, r#"{"overrides":[{"files":[],"rules":{}}]}"#).unwrap();
    assert!(matches!(
        Config::load(Some(&malformed)).unwrap_err(),
        ConfigError::Malformed { path: Some(path), .. } if path == malformed
    ));
    for (name, body) in [
        (
            "bad-rule.json",
            r#"{"overrides":[{"files":["**/*"],"rules":{"unknown":"off"}}]}"#,
        ),
        (
            "bad-severity.json",
            r#"{"overrides":[{"files":["**/*"],"rules":{"require-effect-deps":"fatal"}}]}"#,
        ),
        (
            "bad-glob.json",
            r#"{"overrides":[{"files":["["],"rules":{}}]}"#,
        ),
        (
            "empty-files.json",
            r#"{"overrides":[{"files":[],"rules":{}}]}"#,
        ),
    ] {
        let path = dir.join(name);
        std::fs::write(&path, body).unwrap();
        assert!(matches!(
            Config::load(Some(&path)).unwrap_err(),
            ConfigError::Malformed { path: Some(error_path), .. } if error_path == path
        ));
    }
    std::fs::remove_dir_all(dir).unwrap();
}
