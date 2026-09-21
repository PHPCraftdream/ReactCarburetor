//! Native checks for React Carburetor consumer code.
//!
//! The same rules the JS plugin implements, run as one process over a directory tree instead of
//! once per file through a linter's plugin bridge. The reason is energy rather than convenience: a
//! popular library's rules run on every commit in every consumer's CI, and the difference between
//! a native pass and a JavaScript one is multiplied by all of them.
//!
//! This binary is the fast path. The JS plugin stays, because an ESLint host can only load
//! JavaScript, and a conformance corpus keeps the two from drifting apart.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use ignore::overrides::{Override, OverrideBuilder};
use ignore::WalkBuilder;
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;
use rayon::prelude::*;
use serde::Serialize;

mod config;
mod fix;
mod rules;
mod suppression;

use config::{parse_severity, Config, Severity};
use fix::Fix;
use suppression::Suppression;

/// Directories never worth walking, whatever the ignore files say: generated output and
/// dependencies dwarf the sources and hold code nobody in this project is going to fix.
const NEVER_WALK: [&str; 4] = ["node_modules", "dist", "target", "worktrees"];

/// The exit code for "the linter itself failed", as distinct from "the linter found problems".
/// CI has to tell a broken tool from a failing check; today both would look like a plain failure.
const EXIT_BROKEN: u8 = 2;

/// How many times `--fix` re-parses and re-runs the rules over one file before giving up. A fix
/// that keeps reporting itself is a bug in that rule, not a reason to hang the tool — this bounds
/// the damage to one file taking a little longer, never forever.
const MAX_FIX_PASSES: u32 = 10;

/// One reported problem.
///
/// `file`, `line`, `column`, `rule` and `message` are the conformance contract — the corpus
/// compares this JSON against the JavaScript implementation field by field, so they are not to be
/// renamed. `severity` is additive: the bridge needs it to report at the host's severity. `fix` is
/// native-only — the bridge does not read it, since teaching an ESLint/oxlint host to apply a
/// native fix is a separate project from teaching this binary to apply its own.
#[derive(Debug, Serialize)]
pub struct Diagnostic {
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub rule: String,
    pub message: String,
    pub severity: Severity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<Fix>,
}

/// What a rule receives: the parsed file, and where it came from.
pub struct Source<'a> {
    pub path: &'a Path,
    pub text: &'a str,
}

#[derive(Debug, PartialEq)]
enum Format {
    Human,
    Json,
}

/// Whether this run only reports, writes fixes to disk, or previews them without writing.
#[derive(Debug, Clone, Copy, PartialEq)]
enum FixMode {
    Report,
    Write,
    DryRun,
}

struct Options {
    paths: Vec<PathBuf>,
    format: Format,
    config: Option<PathBuf>,
    /// Severity overrides from the command line, applied over the config file.
    overrides: Vec<(String, Severity)>,
    /// Whether a warning is enough to fail the run.
    deny_warnings: bool,
    fix_mode: FixMode,
}

const USAGE: &str = "\
carburetor-lint [options] [paths...]

  --config <path>          configuration file; default ./.carburetorrc.json when present
  --rule <name>=<severity> override one rule's severity (error, warn, off)
  --format <human|json>    output format; default human
  --deny-warnings          fail the run on warnings too
  --fix                    write every available fix to disk
  --fix-dry-run            print what --fix would change, without writing it
  -h, --help               print this

Exit codes: 0 clean, 1 problems found, 2 the linter itself failed.";

/// Reads the command line. An unknown flag is an error rather than a warning: a typo'd flag that
/// only prints a note is a run that silently did something other than what was asked.
fn parse_options(arguments: Vec<String>) -> Result<Option<Options>, String> {
    let mut paths: Vec<PathBuf> = Vec::new();
    let mut format = Format::Human;
    let mut config: Option<PathBuf> = None;
    let mut overrides: Vec<(String, Severity)> = Vec::new();
    let mut deny_warnings = false;
    let mut fix_mode = FixMode::Report;

    let mut arguments = arguments.into_iter().skip(1);

    while let Some(argument) = arguments.next() {
        // Both spellings of every valued flag: `--flag value` and `--flag=value`. Consumers write
        // one, editors and task runners the other.
        let (flag, inline) = match argument.split_once('=') {
            Some((flag, value)) => (flag.to_string(), Some(value.to_string())),
            None => (argument.clone(), None),
        };

        let mut value = |flag: &str| -> Result<String, String> {
            inline
                .clone()
                .or_else(|| arguments.next())
                .ok_or_else(|| format!("{flag} needs a value"))
        };

        match flag.as_str() {
            "-h" | "--help" => {
                println!("{USAGE}");

                return Ok(None);
            }
            "--format" => {
                format = match value("--format")?.as_str() {
                    "json" => Format::Json,
                    "human" => Format::Human,
                    other => return Err(format!("unknown format {other:?}: expected human or json")),
                };
            }
            "--config" => config = Some(PathBuf::from(value("--config")?)),
            "--rule" => {
                let setting = value("--rule")?;
                let Some((rule, severity)) = setting.split_once('=') else {
                    return Err(format!("--rule needs <name>=<severity>, got {setting:?}"));
                };
                let Some(severity) = parse_severity(severity) else {
                    return Err(format!(
                        "unknown severity {severity:?}: expected \"error\", \"warn\" or \"off\""
                    ));
                };

                overrides.push((rule.to_string(), severity));
            }
            "--deny-warnings" => deny_warnings = true,
            "--fix" if fix_mode == FixMode::DryRun => {
                return Err("--fix and --fix-dry-run are mutually exclusive".to_string());
            }
            "--fix" => fix_mode = FixMode::Write,
            "--fix-dry-run" if fix_mode == FixMode::Write => {
                return Err("--fix and --fix-dry-run are mutually exclusive".to_string());
            }
            "--fix-dry-run" => fix_mode = FixMode::DryRun,
            other if other.starts_with('-') => return Err(format!("unknown option {other}")),
            _ => paths.push(PathBuf::from(argument)),
        }
    }

    if paths.is_empty() {
        paths.push(PathBuf::from("."));
    }

    Ok(Some(Options { paths, format, config, overrides, deny_warnings, fix_mode }))
}

/// The walker's exclusions for one root: the never-walked directories plus the config's patterns.
fn exclusions(root: &Path, ignores: &[String]) -> Result<Override, String> {
    let mut builder = OverrideBuilder::new(root);

    // Only negated globs go in, so this stays a blacklist: one positive glob would turn the
    // override into a whitelist and hide every file that did not match it.
    for directory in NEVER_WALK {
        for pattern in [format!("!**/{directory}"), format!("!**/{directory}/**")] {
            builder.add(&pattern).map_err(|error| error.to_string())?;
        }
    }

    for pattern in ignores {
        builder
            .add(&format!("!{pattern}"))
            .map_err(|error| format!("not a valid ignore pattern {pattern:?}: {error}"))?;
    }

    builder.build().map_err(|error| error.to_string())
}

/// Files worth parsing: TypeScript and JavaScript, minus what the ignore files and config exclude.
fn collect_files(paths: &[PathBuf], ignores: &[String]) -> Result<Vec<PathBuf>, String> {
    let mut files: Vec<PathBuf> = Vec::new();

    for root in paths {
        let walk = WalkBuilder::new(root)
            .hidden(false)
            .overrides(exclusions(root, ignores)?)
            .build();

        for entry in walk.flatten() {
            let path = entry.path();

            if !path.is_file() {
                continue;
            }

            let is_source = matches!(
                path.extension().and_then(|value| value.to_str()),
                Some("ts" | "tsx" | "mts" | "cts" | "js" | "jsx" | "mjs" | "cjs")
            );

            if is_source {
                files.push(path.to_path_buf());
            }
        }
    }

    Ok(files)
}

/// Parses `text` as if it were `path`'s content and runs the rules the config leaves on, dropping
/// what a directive silences. `None` means the parser could not make sense of it — a half-built
/// tree is the compiler's problem to report, not ours, and (for `--fix`) a signal that whatever
/// produced this text broke it and should not be trusted.
fn analyze(path: &Path, text: &str, config: &Config) -> Option<Vec<Diagnostic>> {
    let source_type = SourceType::from_path(path).unwrap_or_default();
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, source_type).parse();

    if !parsed.diagnostics.is_empty() {
        return None;
    }

    let source = Source { path, text };
    let suppression = Suppression::build(&parsed.program);

    Some(
        rules::run(&parsed.program, &source, config)
            .into_iter()
            .filter(|diagnostic| !suppression.silenced(&diagnostic.rule, diagnostic.line))
            .collect(),
    )
}

/// Reads and analyzes one file from disk. An unreadable file is silently skipped, the same as a
/// file the walker should never have handed us.
fn check_file(path: &Path, config: &Config) -> Vec<Diagnostic> {
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };

    analyze(path, &text, config).unwrap_or_default()
}

/// One file's outcome after `--fix`'s pass loop: the diagnostics that remain, and — when the text
/// actually changed — the before and after, for [`run_fix`] to either write or preview.
struct FixOutcome {
    diagnostics: Vec<Diagnostic>,
    change: Option<(String, String)>,
}

/// Re-parses and re-runs the rules over `text` after every fix, applying at most one round of
/// non-overlapping fixes per pass, until nothing fixable remains or [`MAX_FIX_PASSES`] is reached.
/// A fix that turns out to have broken parsing is discarded rather than published: `compute`
/// returning `None` stops the loop on the last text that was known to parse, and that text's own
/// (pre-fix) diagnostics are what gets reported for it.
fn stabilize(
    text: String,
    mut compute: impl FnMut(&str) -> Option<Vec<Diagnostic>>,
) -> (String, Vec<Diagnostic>) {
    let mut text = text;
    let mut diagnostics = compute(&text).unwrap_or_default();

    for _ in 0..MAX_FIX_PASSES {
        let fixes: Vec<&Fix> = diagnostics.iter().filter_map(|diagnostic| diagnostic.fix.as_ref()).collect();

        if fixes.is_empty() {
            break;
        }

        let Some(candidate) = fix::apply(&text, fixes) else { break };

        if candidate == text {
            break;
        }

        match compute(&candidate) {
            Some(next) => {
                text = candidate;
                diagnostics = next;
            }
            None => break,
        }
    }

    (text, diagnostics)
}

/// Runs the fix loop for one file. Reading failures are silent, matching [`check_file`].
fn fix_one_file(path: &Path, config: &Config) -> FixOutcome {
    let Ok(original) = fs::read_to_string(path) else {
        return FixOutcome { diagnostics: Vec::new(), change: None };
    };

    let (final_text, diagnostics) = stabilize(original.clone(), |text| analyze(path, text, config));
    let change = (final_text != original).then_some((original, final_text));

    FixOutcome { diagnostics, change }
}

/// Runs `--fix`/`--fix-dry-run` over every file: [`Write`](FixMode::Write) publishes each changed
/// file atomically, [`DryRun`](FixMode::DryRun) prints a diff and touches nothing.
fn run_fix(files: &[PathBuf], config: &Config, mode: FixMode) -> Result<Vec<Diagnostic>, String> {
    // One task per file, the same reasoning as the plain check: parsing dominates the work.
    let outcomes: Vec<(&PathBuf, FixOutcome)> =
        files.par_iter().map(|path| (path, fix_one_file(path, config))).collect();

    let mut diagnostics = Vec::new();

    for (path, outcome) in outcomes {
        if let Some((original, final_text)) = &outcome.change {
            match mode {
                FixMode::Write => fix::write_atomically(path, final_text)
                    .map_err(|error| format!("could not write {}: {error}", path.display()))?,
                FixMode::DryRun => {
                    println!("--- {}", path.display());
                    print!("{}", fix::diff(original, final_text));
                }
                FixMode::Report => unreachable!("run_fix only runs for Write or DryRun"),
            }
        }

        diagnostics.extend(outcome.diagnostics);
    }

    Ok(diagnostics)
}

fn report(diagnostics: &[Diagnostic], format: &Format) {
    if *format == Format::Json {
        let encoded = serde_json::to_string_pretty(diagnostics).unwrap_or_else(|_| "[]".to_string());

        println!("{encoded}");

        return;
    }

    for diagnostic in diagnostics {
        println!(
            "{}:{}:{}: {} {} — {}",
            diagnostic.file,
            diagnostic.line,
            diagnostic.column,
            diagnostic.severity.label(),
            diagnostic.rule,
            diagnostic.message
        );
    }

    if diagnostics.is_empty() {
        println!("carburetor-lint: no problems found");
    }
}

/// The whole run, with every failure that is the linter's own fault as an `Err`.
fn lint(options: &Options) -> Result<Vec<Diagnostic>, String> {
    let mut config = Config::load(options.config.as_deref()).map_err(|error| error.to_string())?;

    for (rule, severity) in &options.overrides {
        config.override_rule(rule, *severity).map_err(|error| error.to_string())?;
    }

    let files = collect_files(&options.paths, config.ignores())?;

    let mut diagnostics: Vec<Diagnostic> = match options.fix_mode {
        // One task per file: parsing dominates the work and is embarrassingly parallel.
        FixMode::Report => files.par_iter().flat_map(|path| check_file(path, &config)).collect(),
        FixMode::Write | FixMode::DryRun => run_fix(&files, &config, options.fix_mode)?,
    };

    diagnostics.sort_by(|left, right| {
        (&left.file, left.line, left.column, &left.rule)
            .cmp(&(&right.file, right.line, right.column, &right.rule))
    });

    Ok(diagnostics)
}

fn main() -> ExitCode {
    let options = match parse_options(std::env::args().collect()) {
        Ok(Some(options)) => options,
        // `--help` printed the usage and there is nothing to lint.
        Ok(None) => return ExitCode::SUCCESS,
        Err(reason) => {
            eprintln!("carburetor-lint: {reason}");
            eprintln!("{USAGE}");

            return ExitCode::from(EXIT_BROKEN);
        }
    };

    let diagnostics = match lint(&options) {
        Ok(diagnostics) => diagnostics,
        Err(reason) => {
            eprintln!("carburetor-lint: {reason}");

            return ExitCode::from(EXIT_BROKEN);
        }
    };

    report(&diagnostics, &options.format);

    // A warning is a note, not a failure — the same line oxlint draws, and the bridge inherits it.
    // `--deny-warnings` is how CI opts into the stricter reading.
    let failed = diagnostics
        .iter()
        .any(|diagnostic| diagnostic.severity == Severity::Error)
        || (options.deny_warnings && !diagnostics.is_empty());

    if failed {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn diagnostic_with_fix(fix: Fix) -> Diagnostic {
        Diagnostic {
            file: "fixture.tsx".to_string(),
            line: 1,
            column: 1,
            rule: "carburetor/test-rule".to_string(),
            message: "test".to_string(),
            severity: Severity::Error,
            fix: Some(fix),
        }
    }

    #[test]
    fn stabilize_stops_once_nothing_is_fixable() {
        let (text, diagnostics) = stabilize("clean".to_string(), |_| Some(Vec::new()));

        assert_eq!(text, "clean");
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn stabilize_applies_a_fix_and_recomputes_once() {
        let (text, diagnostics) = stabilize("old".to_string(), |current| {
            if current == "old" {
                Some(vec![diagnostic_with_fix(Fix { start: 0, end: 3, text: "new".to_string() })])
            } else {
                Some(Vec::new())
            }
        });

        assert_eq!(text, "new");
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn stabilize_never_exceeds_the_pass_limit_when_a_fix_keeps_reporting_itself() {
        // A pathological fix that flips the text forever and reports a violation every time: proof
        // the loop stops on its own rather than hanging the tool.
        let mut calls = 0u32;

        let (text, diagnostics) = stabilize("a".to_string(), |current| {
            calls += 1;
            let flipped = if current == "a" { "b" } else { "a" };

            Some(vec![diagnostic_with_fix(Fix {
                start: 0,
                end: current.len() as u32,
                text: flipped.to_string(),
            })])
        });

        assert_eq!(calls, MAX_FIX_PASSES + 1, "one initial computation, then one per pass");
        assert!(!diagnostics.is_empty(), "the oscillating rule never actually stabilizes");
        assert!(text == "a" || text == "b");
    }

    #[test]
    fn a_fix_that_breaks_parsing_is_discarded() {
        let (text, diagnostics) = stabilize("good".to_string(), |current| {
            if current == "good" {
                // Reports a fix, but validating the candidate ("broken") fails to parse.
                Some(vec![diagnostic_with_fix(Fix { start: 0, end: 4, text: "broken".to_string() })])
            } else {
                None
            }
        });

        assert_eq!(text, "good", "the last text known to parse is kept");
        assert_eq!(diagnostics.len(), 1, "the pre-fix diagnostics are what gets reported");
    }

    #[test]
    fn two_overlapping_fixes_need_two_passes_to_both_land() {
        // "XY": pass 1 offers two overlapping fixes ([0,1) and [0,2)); apply() keeps only the
        // first, producing "1Y". Pass 2 offers a fresh, now non-overlapping fix for what is left.
        let (text, diagnostics) = stabilize("XY".to_string(), |current| match current {
            "XY" => Some(vec![
                diagnostic_with_fix(Fix { start: 0, end: 1, text: "1".to_string() }),
                diagnostic_with_fix(Fix { start: 0, end: 2, text: "22".to_string() }),
            ]),
            "1Y" => Some(vec![diagnostic_with_fix(Fix { start: 1, end: 2, text: "2".to_string() })]),
            _ => Some(Vec::new()),
        });

        assert_eq!(text, "12");
        assert!(diagnostics.is_empty());
    }
}
