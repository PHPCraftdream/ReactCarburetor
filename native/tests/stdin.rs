//! The `--stdin` mode: an unsaved buffer analyzed as the file the host names.

use std::process::{Command, Output};

use serde_json::Value;

/// Runs the binary from the crate root, the way [`super`] does, so fixture paths behave the same.
#[allow(dead_code)]
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

/// The diagnostics of a `--stdin` run over `text`, analyzed as `name`.
fn stdin_diagnostics(name: &str, text: &str) -> Vec<Value> {
    use std::io::Write;
    use std::process::Stdio;

    let mut child = Command::new(env!("CARGO_BIN_EXE_carburetor-lint"))
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .args(["--format=json", "--stdin", name])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("the binary runs");

    child
        .stdin
        .as_mut()
        .expect("stdin is piped")
        .write_all(text.as_bytes())
        .expect("the buffer is written");

    let output = child.wait_with_output().expect("the process finishes");
    let text = String::from_utf8_lossy(&output.stdout).to_string();

    serde_json::from_str::<Value>(&text)
        .unwrap_or_else(|error| panic!("output is not JSON ({error}): {text}"))
        .as_array()
        .expect("the top level is an array")
        .clone()
}


#[test]
fn stdin_lints_the_buffer_as_if_it_were_the_named_file() {
    // A violation that exists only in the buffer, with nothing on disk under that name.
    let found = stdin_diagnostics(
        "buffers/unsaved.tsx",
        "class Row extends AntiHookComponent {
    save() { this.useCarburetor(store); }
}
",
    );

    assert_eq!(found.len(), 1, "{found:#?}");
    assert_eq!(
        found[0]["rule"],
        "carburetor/no-use-carburetor-outside-render"
    );
    assert_eq!(found[0]["line"], 2);
    assert_eq!(found[0]["file"], "buffers/unsaved.tsx");
}

#[test]
fn stdin_reports_nothing_for_a_buffer_that_does_not_parse() {
    let found = stdin_diagnostics("buffers/broken.tsx", "class {{{");

    assert!(found.is_empty(), "{found:#?}");
}

#[test]
fn stdin_rejects_fix_modes_and_extra_paths() {
    // Exit code 2: the linter itself refused the invocation, it did not find nothing.
    assert_eq!(code(&run(&["--fix", "--stdin=x.tsx"])), 2);
    assert_eq!(code(&run(&["--stdin=x.tsx", "."])), 2);
}
