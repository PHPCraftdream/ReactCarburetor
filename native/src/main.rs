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
mod rules;
mod suppression;

use config::{parse_severity, Config, Severity};
use suppression::Suppression;

/// Directories never worth walking, whatever the ignore files say: generated output and
/// dependencies dwarf the sources and hold code nobody in this project is going to fix.
const NEVER_WALK: [&str; 4] = ["node_modules", "dist", "target", "worktrees"];

/// The exit code for "the linter itself failed", as distinct from "the linter found problems".
/// CI has to tell a broken tool from a failing check; today both would look like a plain failure.
const EXIT_BROKEN: u8 = 2;

/// One reported problem.
///
/// `file`, `line`, `column`, `rule` and `message` are the conformance contract — the corpus
/// compares this JSON against the JavaScript implementation field by field, so they are not to be
/// renamed. `severity` is additive: the bridge needs it to report at the host's severity.
#[derive(Debug, Serialize)]
pub struct Diagnostic {
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub rule: String,
    pub message: String,
    pub severity: Severity,
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

struct Options {
    paths: Vec<PathBuf>,
    format: Format,
    config: Option<PathBuf>,
    /// Severity overrides from the command line, applied over the config file.
    overrides: Vec<(String, Severity)>,
    /// Whether a warning is enough to fail the run.
    deny_warnings: bool,
}

const USAGE: &str = "\
carburetor-lint [options] [paths...]

  --config <path>          configuration file; default ./.carburetorrc.json when present
  --rule <name>=<severity> override one rule's severity (error, warn, off)
  --format <human|json>    output format; default human
  --deny-warnings          fail the run on warnings too
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
            other if other.starts_with('-') => return Err(format!("unknown option {other}")),
            _ => paths.push(PathBuf::from(argument)),
        }
    }

    if paths.is_empty() {
        paths.push(PathBuf::from("."));
    }

    Ok(Some(Options { paths, format, config, overrides, deny_warnings }))
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

/// Parses one file, runs the rules the config leaves on, and drops what a directive silences.
/// Parse errors are left to the compiler to report.
fn check_file(path: &Path, config: &Config) -> Vec<Diagnostic> {
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };

    let source_type = SourceType::from_path(path).unwrap_or_default();
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, &text, source_type).parse();

    // A file the parser could not make sense of is the compiler's problem to report, not ours:
    // running rules over a half-built tree would produce nonsense diagnostics.
    if !parsed.diagnostics.is_empty() {
        return Vec::new();
    }

    let source = Source { path, text: &text };
    let suppression = Suppression::build(&parsed.program);

    rules::run(&parsed.program, &source, config)
        .into_iter()
        .filter(|diagnostic| !suppression.silenced(&diagnostic.rule, diagnostic.line))
        .collect()
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

    // One task per file: parsing dominates the work and is embarrassingly parallel.
    let mut diagnostics: Vec<Diagnostic> = files
        .par_iter()
        .flat_map(|path| check_file(path, &config))
        .collect();

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
