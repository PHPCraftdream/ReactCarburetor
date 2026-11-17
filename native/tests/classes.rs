//! End-to-end tests for the functional-class rules: a project with a `classes` section, its
//! stylesheets and the markup that uses them, run through the real binary — the walk, the class
//! index built before any file, `--stdin` for both kinds of buffer, and the exit codes.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};

use serde_json::Value;

const CONFIG: &str = r#"{"classes": {"css": ["src/**/*.css"]}}"#;

const STYLES: &str = r#"@import "tailwindcss";

:root {
  --palette-blue-600: #2563eb;
  --palette-blue-700: #1d4ed8;
  --palette-gray-100: #f3f4f6;
  --palette-gray-900: #111827;
  --palette-white: #fff;
}

@theme {
  --color-*: initial;
  --color-accent-fill: var(--palette-blue-600);
  --color-accent-fill-hover: var(--palette-blue-700);
  --color-accent-on-fill: var(--palette-white);
  --color-accent-edge: var(--palette-blue-600);
  --color-neutral-ink: var(--palette-gray-900);
  --color-surface-raised: var(--palette-gray-100);
}

@utility tone-accent-solid {
  @apply bg-accent-fill text-accent-on-fill hover:bg-accent-fill-hover;
}
@utility tone-surface-raised {
  @apply bg-surface-raised text-neutral-ink;
}
@utility shape-control { @apply h-10 px-4 rounded-md; }
@utility type-label { @apply text-sm font-medium; }
@utility pattern-button { @apply shape-control type-label; }

@layer components {
  .submit-button { @apply pattern-button tone-accent-solid; }
  .user-card { @apply shape-control tone-surface-raised; }
}
"#;

const APP: &str = r#"export const App = () => (
    <div className="user-card">
        <button className="submit-button">Save</button>
    </div>
);
"#;

/// A fresh project directory seeded with `files`; nested paths create their directories.
fn project(files: &[(&str, &str)]) -> PathBuf {
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let id = COUNTER.fetch_add(1, Ordering::Relaxed);

    let dir = std::env::temp_dir().join(format!(
        "carburetor-classes-cli-{}-{id}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);

    for (name, content) in files {
        let path = dir.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    dir
}

fn run(cwd: &Path, arguments: &[&str], stdin: Option<&str>) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_carburetor-lint"))
        .current_dir(cwd)
        .args(arguments)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the binary runs");
    {
        let mut input = child.stdin.take().unwrap();
        input
            .write_all(stdin.unwrap_or_default().as_bytes())
            .unwrap();
    }
    child.wait_with_output().expect("the binary finishes")
}

fn code(output: &Output) -> i32 {
    output.status.code().expect("the process exited normally")
}

/// The rules under test; the project's TSX is also checked by every recommended rule, which is not
/// what these tests are about.
const CLASS_RULES: [&str; 9] = [
    "carburetor/valid-palette-token",
    "carburetor/valid-color-role",
    "carburetor/valid-tone-class",
    "carburetor/valid-trait-class",
    "carburetor/valid-pattern-class",
    "carburetor/valid-function-class",
    "carburetor/no-unknown-class-reference",
    "carburetor/no-duplicate-class",
    "carburetor/require-function-class",
];

/// `(file, line, rule)` of a `--format=json` run's class-rule findings, in report order.
fn findings(output: &Output) -> Vec<(String, u64, String)> {
    let text = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str::<Value>(&text)
        .unwrap_or_else(|error| panic!("output is not JSON ({error}): {text}"))
        .as_array()
        .expect("the top level is an array")
        .iter()
        .map(|diagnostic| {
            (
                diagnostic["file"].as_str().unwrap().to_string(),
                diagnostic["line"].as_u64().unwrap(),
                diagnostic["rule"].as_str().unwrap().to_string(),
            )
        })
        .filter(|(_, _, rule)| CLASS_RULES.contains(&rule.as_str()))
        .collect()
}

#[test]
fn a_project_built_by_the_methodology_is_clean() {
    let dir = project(&[
        (".carburetorrc.json", CONFIG),
        ("src/styles/app.css", STYLES),
        ("src/App.tsx", APP),
    ]);

    let output = run(&dir, &["--format=json", "src"], None);
    assert_eq!(findings(&output), []);
    assert_eq!(code(&output), 0);
}

#[test]
fn offences_in_markup_and_in_css_are_reported_with_their_files() {
    let styles = format!("{STYLES}\n@utility tone-accent-plain {{\n  @apply px-4;\n}}\n");
    let app = "export const App = () => <div className=\"px-4 user-card\" />;\n";
    let dir = project(&[
        (".carburetorrc.json", CONFIG),
        ("src/styles/app.css", &styles),
        ("src/App.tsx", app),
    ]);

    let output = run(&dir, &["--format=json", "src"], None);
    let lines_of_styles = STYLES.lines().count() as u64;
    assert_eq!(
        findings(&output),
        [
            (
                "src/App.tsx".to_string(),
                1,
                "carburetor/require-function-class".to_string()
            ),
            (
                "src/styles/app.css".to_string(),
                lines_of_styles + 3,
                "carburetor/valid-tone-class".to_string()
            ),
        ]
    );
    assert_eq!(code(&output), 1);
}

#[test]
fn stylesheets_outside_the_configured_globs_are_neither_read_nor_checked() {
    let dir = project(&[
        (".carburetorrc.json", CONFIG),
        ("src/styles/app.css", STYLES),
        ("vendor/legacy.css", ".legacy { @apply nonsense; }\n"),
        (
            "src/App.tsx",
            "export const A = () => <div className=\"legacy\" />;\n",
        ),
    ]);

    let output = run(&dir, &["--format=json", "src", "vendor"], None);
    assert_eq!(
        findings(&output),
        [(
            "src/App.tsx".to_string(),
            1,
            "carburetor/require-function-class".to_string()
        )]
    );
}

#[test]
fn without_a_classes_section_nothing_changes() {
    let dir = project(&[
        ("src/styles/app.css", ".loose { @apply nonsense; }\n"),
        (
            "src/App.tsx",
            "export const A = () => <div className=\"px-4 mt-2\" />;\n",
        ),
    ]);

    let output = run(&dir, &["--format=json", "src"], None);
    assert_eq!(findings(&output), []);
    assert_eq!(code(&output), 0);
}

#[test]
fn stdin_checks_a_tsx_buffer_against_the_stylesheets_on_disk() {
    let dir = project(&[
        (".carburetorrc.json", CONFIG),
        ("src/styles/app.css", STYLES),
        ("src/App.tsx", APP),
    ]);
    let buffer = "export const A = () => <div className=\"tone-accent-solid\" />;\n";

    let output = run(
        &dir,
        &["--format=json", "--stdin", "src/App.tsx"],
        Some(buffer),
    );
    assert_eq!(
        findings(&output),
        [(
            "src/App.tsx".to_string(),
            1,
            "carburetor/require-function-class".to_string()
        )]
    );
}

#[test]
fn stdin_checks_an_unsaved_stylesheet_in_place_of_its_file() {
    let dir = project(&[
        (".carburetorrc.json", CONFIG),
        ("src/styles/app.css", STYLES),
        ("src/App.tsx", APP),
    ]);
    let buffer = STYLES.replace(
        "@apply shape-control type-label;",
        "@apply shape-control type-label px-2;",
    );

    let output = run(
        &dir,
        &["--format=json", "--stdin", "src/styles/app.css"],
        Some(&buffer),
    );
    let reported = findings(&output);
    assert_eq!(reported.len(), 1, "{reported:?}");
    assert_eq!(reported[0].2, "carburetor/valid-pattern-class");
}

#[test]
fn a_rule_can_be_switched_off_and_a_css_comment_silences_its_line() {
    let styles = format!(
        "{STYLES}\n/* carburetor-disable-next-line no-unknown-class-reference */\n@utility shape-odd {{ @apply nonsense; }}\n@utility shape-odder {{ @apply nonsense; }}\n"
    );
    let dir = project(&[
        (".carburetorrc.json", CONFIG),
        ("src/styles/app.css", &styles),
    ]);

    let output = run(&dir, &["--format=json", "src"], None);
    let rules: Vec<String> = findings(&output)
        .into_iter()
        .map(|(_, _, rule)| rule)
        .collect();
    assert_eq!(rules, ["carburetor/no-unknown-class-reference"]);

    let off = run(
        &dir,
        &[
            "--format=json",
            "--rule",
            "carburetor/no-unknown-class-reference=off",
            "src",
        ],
        None,
    );
    assert_eq!(findings(&off), []);
}

#[test]
fn a_stylesheet_that_does_not_scan_reports_nothing() {
    let dir = project(&[
        (".carburetorrc.json", CONFIG),
        ("src/styles/app.css", STYLES),
        (
            "src/styles/broken.css",
            "@utility shape-x { @apply nonsense;\n",
        ),
    ]);

    let output = run(&dir, &["--format=json", "src"], None);
    assert_eq!(findings(&output), []);
}

#[test]
fn an_invalid_classes_section_is_a_broken_run() {
    let dir = project(&[
        (".carburetorrc.json", r#"{"classes": {"css": []}}"#),
        ("src/App.tsx", APP),
    ]);

    let output = run(&dir, &["src"], None);
    assert_eq!(code(&output), 2);
    assert!(String::from_utf8_lossy(&output.stderr).contains("\"classes.css\" must not be empty"));
}

#[test]
fn a_root_key_points_the_globs_at_another_directory() {
    let dir = project(&[
        ("project/src/styles/app.css", STYLES),
        ("project/src/App.tsx", APP),
        (
            "bridge/config.json",
            r#"{"root": "../project", "classes": {"css": ["src/**/*.css"]}}"#,
        ),
    ]);

    let output = run(
        &dir.join("project"),
        &["--config", "../bridge/config.json", "--format=json", "src"],
        None,
    );
    assert_eq!(findings(&output), []);
    assert_eq!(code(&output), 0);

    let broken = run(
        &dir.join("project"),
        &[
            "--config",
            "../bridge/config.json",
            "--format=json",
            "--stdin",
            "src/App.tsx",
        ],
        Some("export const A = () => <div className=\"px-4\" />;\n"),
    );
    assert_eq!(findings(&broken).len(), 1);
}

#[test]
fn init_classes_writes_a_scaffold_the_rules_accept_and_a_config_that_reads_it() {
    let dir = project(&[(
        "src/App.tsx",
        "export const A = () => <button className=\"submit-button\" />;\n",
    )]);

    let output = run(&dir, &["--init-classes", "src/styles/classes.css"], None);
    assert_eq!(
        code(&output),
        0,
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report = String::from_utf8_lossy(&output.stdout);
    assert!(report.contains("wrote src/styles/classes.css"), "{report}");
    assert!(report.contains("created .carburetorrc.json"), "{report}");

    let config: Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join(".carburetorrc.json")).unwrap())
            .unwrap();
    assert_eq!(config["classes"]["css"][0], "src/styles/classes.css");

    let lint = run(&dir, &["--format=json", "src"], None);
    assert_eq!(findings(&lint), []);
    assert_eq!(code(&lint), 0);

    let again = run(&dir, &["--init-classes", "src/styles/classes.css"], None);
    assert_eq!(code(&again), 2);
    assert!(String::from_utf8_lossy(&again.stderr).contains("already exists"));
}

#[test]
fn init_classes_leaves_an_existing_config_alone_and_says_what_to_add() {
    let rc = r#"{"componentBases": ["Screen"]}"#;
    let dir = project(&[(".carburetorrc.json", rc)]);

    let output = run(&dir, &["--init-classes", "styles/app.css"], None);
    assert_eq!(code(&output), 0);
    assert!(String::from_utf8_lossy(&output.stdout).contains("has no classes section"));
    assert_eq!(
        std::fs::read_to_string(dir.join(".carburetorrc.json")).unwrap(),
        rc
    );
    assert!(dir.join("styles/app.css").exists());
}

#[test]
fn init_classes_follows_the_configured_vocabulary() {
    let dir = project(&[(
        ".carburetorrc.json",
        r#"{"classes": {"css": ["css/*.css"], "families": ["brand"]}}"#,
    )]);

    let output = run(&dir, &["--init-classes", "css/classes.css"], None);
    assert_eq!(code(&output), 0);
    let text = std::fs::read_to_string(dir.join("css/classes.css")).unwrap();
    assert!(text.contains("@utility tone-brand-solid"));
    assert!(!text.contains("tone-accent"));

    let lint = run(&dir, &["--format=json", "css"], None);
    assert_eq!(findings(&lint), []);
}

#[test]
fn init_classes_lints_nothing_and_refuses_paths() {
    let dir = project(&[("src/App.tsx", APP)]);

    let output = run(&dir, &["--init-classes", "a.css", "src"], None);
    assert_eq!(code(&output), 2);
    assert!(!dir.join("a.css").exists());
}
