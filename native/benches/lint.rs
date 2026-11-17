//! Fixed-iteration benchmarks of the release binary, on bench-scale-tool: each workload runs the
//! number of iterations pinned in `native/bench-iters.txt`, so the wall time of a run is the speed
//! signal. `cargo bench --bench lint` runs them; `-- --calibrate 1` re-pins the counts;
//! `BENCH_SCALE=0.2` (or `-- --scale 0.2`) runs a fifth of every count for a quick pulse.
//!
//! Every workload spawns the binary on a generated project, like a user's `carburetor-lint` run, and
//! each project is checked once before timing: a binary that stopped analysing cannot look fast.
//! The perf gates in `perf/gates/lint*.mjs` stay the blocking scaling guards; these are the pulse.

use std::fs;
use std::hint::black_box;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use bench_scale_tool::Harness;

const BINARY: &str = env!("CARGO_BIN_EXE_carburetor-lint");

/// A fresh directory under Cargo's per-target temporary directory.
fn workspace(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("create the bench workspace");
    dir
}

fn lint(dir: &Path, args: &[&str]) -> Output {
    Command::new(BINARY)
        .args(args)
        .current_dir(dir)
        .output()
        .expect("run carburetor-lint")
}

/// How many findings of `rule` a JSON report holds.
fn count(output: &Output, rule: &str) -> usize {
    let findings: Vec<serde_json::Value> =
        serde_json::from_slice(&output.stdout).expect("a JSON report");
    findings
        .iter()
        .filter(|finding| finding["rule"] == rule)
        .count()
}

/// `count` nested functions that use nothing from their parent: one require-module-function finding
/// each, so the run pays for the capture analysis (as perf/scenarios/lint-binary/scaling.mjs).
fn module_functions(count: usize) -> PathBuf {
    let dir = workspace(&format!("module-functions-{count}"));
    let source: String = (0..count)
        .map(|index| {
            format!(
                "export function f{index}(x: number) {{ return function () {{ return 1; }}; }}\n"
            )
        })
        .collect();
    fs::write(dir.join("generated.ts"), source).expect("write the corpus");
    dir
}

/// `count` Functions in one stylesheet and `count` elements across TSX files; every fourth Function
/// applies a Brick and every second element carries a Tone (as perf/scenarios/lint-binary/classes.mjs).
fn class_project(count: usize) -> PathBuf {
    let dir = workspace(&format!("classes-{count}"));
    fs::create_dir_all(dir.join("src/styles")).expect("create src/styles");
    fs::write(
        dir.join(".carburetorrc.json"),
        r#"{"classes": {"css": ["src/**/*.css"]}}"#,
    )
    .expect("write the config");

    let mut css = String::from(
        ":root { --palette-blue-600: #2563eb; --palette-white: #fff; }
@theme {
  --color-*: initial;
  --color-accent-fill: var(--palette-blue-600);
  --color-accent-on-fill: var(--palette-white);
}
@utility tone-accent-solid { @apply bg-accent-fill text-accent-on-fill; }
@utility shape-control { @apply h-10 px-4 rounded-md; }
@utility type-label { @apply text-sm font-medium; }
@utility pattern-button { @apply shape-control type-label; }
@layer components {
",
    );
    for index in 0..count {
        let brick = if index % 4 == 0 { " px-1" } else { "" };
        css += &format!(
            "  .item{index}-button {{ @apply pattern-button tone-accent-solid{brick}; }}\n"
        );
    }
    css += "}\n";
    fs::write(dir.join("src/styles/app.css"), css).expect("write the stylesheet");

    const PER_FILE: usize = 100;
    for file in 0..count.div_ceil(PER_FILE) {
        let mut source = format!("export const View{file} = () => (\n    <div>\n");
        for index in file * PER_FILE..count.min((file + 1) * PER_FILE) {
            let class = if index % 2 == 0 {
                "tone-accent-solid".to_string()
            } else {
                format!("item{index}-button")
            };
            source += &format!("        <button className=\"{class}\">x</button>\n");
        }
        source += "    </div>\n);\n";
        fs::write(dir.join(format!("src/View{file}.tsx")), source).expect("write a view");
    }
    dir
}

fn main() {
    let mut harness = Harness::new("lint", env!("CARGO_MANIFEST_DIR"));

    let functions = module_functions(2000);
    let args = [
        "--rule",
        "carburetor/require-module-function=error",
        "--format=json",
        "generated.ts",
    ];
    let checked = lint(&functions, &args);
    assert_eq!(
        count(&checked, "carburetor/require-module-function"),
        2000,
        "the module-function corpus is not analysed"
    );
    harness.bench("module-functions@2k", move || {
        black_box(lint(&functions, &args));
    });

    let classes = class_project(2000);
    let checked = lint(&classes, &["--format=json", "src"]);
    assert_eq!(count(&checked, "carburetor/require-function-class"), 1000);
    assert_eq!(count(&checked, "carburetor/valid-function-class"), 500);
    harness.bench("classes@2k", move || {
        black_box(lint(&classes, &["--format=json", "src"]));
    });

    // --init-classes never overwrites a stylesheet, so every iteration starts without one.
    let scaffold = workspace("init-classes");
    let target = scaffold.join("classes.css");
    harness.bench_batched(
        "init-classes",
        move || {
            let _ = fs::remove_file(&target);
        },
        move |()| {
            let output = lint(&scaffold, &["--init-classes", "classes.css"]);
            assert!(output.status.success(), "--init-classes failed");
            black_box(output);
        },
    );

    harness.run();
}
