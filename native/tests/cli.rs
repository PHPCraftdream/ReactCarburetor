//! End-to-end tests for the binary: the command line, the config file, suppression directives,
//! both output formats and the exit codes.
//!
//! These run the real executable rather than calling into the crate, because the parts under test
//! are exactly the ones a unit test cannot see: argument parsing, the walk, and what the process
//! exits with. The fixtures live in `tests/fixtures` and every path below is relative to the crate
//! root, which is where the binary is run from.

use std::path::Path;
use std::process::{Command, Output};

use serde_json::Value;

const RULE: &str = "carburetor/no-lifecycle-class-property";

/// Runs the binary from the crate root, so relative fixture paths resolve and the default config
/// lookup finds no `.carburetorrc.json`.
fn run(arguments: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_carburetor-lint"))
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .args(arguments)
        .output()
        .expect("the binary runs")
}

fn code(output: &Output) -> i32 {
    output.status.code().expect("the process exited normally")
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).to_string()
}

/// The diagnostics of a `--format=json` run.
fn diagnostics(arguments: &[&str]) -> Vec<Value> {
    let output = run(arguments);
    let text = stdout(&output);

    serde_json::from_str::<Value>(&text)
        .unwrap_or_else(|error| panic!("output is not JSON ({error}): {text}"))
        .as_array()
        .expect("the top level is an array")
        .clone()
}

#[test]
fn a_violation_is_reported_and_fails_the_run() {
    let output = run(&["tests/fixtures/offender.tsx"]);

    assert_eq!(code(&output), 1);

    let text = stdout(&output);
    assert!(text.contains(RULE), "{text}");
    assert!(text.contains("tests/fixtures/offender.tsx:3:5"), "{text}");
    assert!(text.contains("error"), "{text}");
}

#[test]
fn a_clean_file_exits_zero() {
    let output = run(&["tests/fixtures/clean.tsx"]);

    assert_eq!(code(&output), 0);
    assert!(stdout(&output).contains("no problems found"));
}

#[test]
fn json_carries_exactly_the_conformance_fields() {
    let found = diagnostics(&["--format=json", "tests/fixtures/offender.tsx"]);

    assert_eq!(found.len(), 1);

    let diagnostic = found[0].as_object().expect("a diagnostic is an object");

    // The conformance corpus compares these names against the JavaScript implementation, so the
    // set is asserted whole: a renamed or dropped field has to fail here, not there.
    let mut keys: Vec<&str> = diagnostic.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(keys, ["column", "file", "line", "message", "rule", "severity"]);

    assert_eq!(diagnostic["file"], "tests/fixtures/offender.tsx");
    assert_eq!(diagnostic["line"], 3);
    assert_eq!(diagnostic["column"], 5);
    assert_eq!(diagnostic["rule"], RULE);
    assert_eq!(diagnostic["severity"], "error");
    assert!(diagnostic["message"].as_str().expect("a message").contains("class property"));
}

#[test]
fn both_spellings_of_the_format_flag_work() {
    let inline = run(&["--format=json", "tests/fixtures/clean.tsx"]);
    let separate = run(&["--format", "json", "tests/fixtures/clean.tsx"]);

    assert_eq!(stdout(&inline).trim(), "[]");
    assert_eq!(stdout(&separate).trim(), "[]");
}

#[test]
fn a_carburetor_directive_silences_the_line_below_it() {
    let output = run(&["tests/fixtures/silenced.tsx"]);

    assert_eq!(code(&output), 0);
    assert!(stdout(&output).contains("no problems found"));
}

#[test]
fn the_oxlint_spelling_silences_it_too() {
    // A file must not need two comments to silence one rule in two linters.
    let output = run(&["tests/fixtures/silencedOxlint.tsx"]);

    assert_eq!(code(&output), 0);
    assert!(stdout(&output).contains("no problems found"));
}

#[test]
fn a_rule_turned_off_in_the_config_produces_nothing() {
    let found = diagnostics(&[
        "--config",
        "tests/fixtures/configs/off.json",
        "--format=json",
        "tests/fixtures/offender.tsx",
    ]);

    assert!(found.is_empty());
}

#[test]
fn a_warning_is_reported_without_failing_the_run() {
    let arguments = ["--config=tests/fixtures/configs/warn.json", "tests/fixtures/offender.tsx"];

    let output = run(&arguments);
    assert_eq!(code(&output), 0);
    assert!(stdout(&output).contains("warn"), "{}", stdout(&output));

    let found = diagnostics(&[arguments[0], "--format=json", arguments[1]]);
    assert_eq!(found[0]["severity"], "warn");
}

#[test]
fn deny_warnings_makes_a_warning_fail_the_run() {
    let output = run(&[
        "--config=tests/fixtures/configs/warn.json",
        "--deny-warnings",
        "tests/fixtures/offender.tsx",
    ]);

    assert_eq!(code(&output), 1);
}

#[test]
fn a_command_line_override_wins_over_the_defaults() {
    let warned = run(&[&format!("--rule={RULE}=warn"), "tests/fixtures/offender.tsx"]);
    assert_eq!(code(&warned), 0);

    let silenced = diagnostics(&[
        &format!("--rule={RULE}=off"),
        "--format=json",
        "tests/fixtures/offender.tsx",
    ]);
    assert!(silenced.is_empty());
}

#[test]
fn generated_output_and_dependencies_are_never_walked() {
    let found = diagnostics(&["--format=json", "tests/fixtures/tree"]);
    let files: Vec<&str> = found
        .iter()
        .map(|diagnostic| diagnostic["file"].as_str().expect("a path"))
        .collect();

    // `dist` and `node_modules` hold the same violation and neither is excluded by a .gitignore
    // here, so their absence is this binary's own doing; `generated` is still walked, because only
    // a config pattern excludes it.
    assert_eq!(
        files,
        ["tests/fixtures/tree/app.tsx", "tests/fixtures/tree/generated/built.tsx"]
    );
}

#[test]
fn config_ignore_patterns_exclude_what_they_name() {
    let found = diagnostics(&[
        "--config=tests/fixtures/configs/ignore.json",
        "--format=json",
        "tests/fixtures/tree",
    ]);
    let files: Vec<&str> = found
        .iter()
        .map(|diagnostic| diagnostic["file"].as_str().expect("a path"))
        .collect();

    assert_eq!(files, ["tests/fixtures/tree/app.tsx"]);
}

#[test]
fn a_malformed_config_exits_two() {
    let output = run(&["--config=tests/fixtures/configs/broken.json", "tests/fixtures/offender.tsx"]);

    // Two, not one: CI has to tell "the tool broke" from "the check failed".
    assert_eq!(code(&output), 2);
    assert!(String::from_utf8_lossy(&output.stderr).contains("unknown severity"));
}

#[test]
fn a_config_that_is_not_there_exits_two_when_asked_for_explicitly() {
    let output = run(&["--config=tests/fixtures/configs/absent.json", "tests/fixtures/clean.tsx"]);

    assert_eq!(code(&output), 2);
}

#[test]
fn a_missing_default_config_is_not_an_error() {
    assert!(!Path::new(env!("CARGO_MANIFEST_DIR")).join(".carburetorrc.json").exists());

    let output = run(&["tests/fixtures/clean.tsx"]);

    assert_eq!(code(&output), 0);
}

#[test]
fn an_unknown_option_exits_two() {
    let output = run(&["--fix-everything", "tests/fixtures/clean.tsx"]);

    assert_eq!(code(&output), 2);
    assert!(String::from_utf8_lossy(&output.stderr).contains("unknown option"));
}

#[test]
fn an_unknown_rule_or_severity_on_the_command_line_exits_two() {
    assert_eq!(code(&run(&["--rule=carburetor/no-such-rule=error", "tests/fixtures/clean.tsx"])), 2);
    assert_eq!(code(&run(&[&format!("--rule={RULE}=fatal"), "tests/fixtures/clean.tsx"])), 2);
    assert_eq!(code(&run(&["--rule", "tests/fixtures/clean.tsx"])), 2);
    assert_eq!(code(&run(&["--format=xml", "tests/fixtures/clean.tsx"])), 2);
}

#[test]
fn help_prints_the_usage_and_lints_nothing() {
    let output = run(&["--help"]);

    assert_eq!(code(&output), 0);
    assert!(stdout(&output).contains("carburetor-lint [options]"));
    assert!(stdout(&output).contains("Exit codes"));
}
