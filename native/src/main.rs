//! Native checks for React Carburetor consumer code.
//!
//! The same rules the JS plugin implements, run as one process over a directory tree instead of
//! once per file through a linter's plugin bridge. The reason is energy rather than convenience: a
//! popular library's rules run on every commit in every consumer's CI, and the difference between
//! a native pass and a JavaScript one is multiplied by all of them.
//!
//! This binary is the fast path. The JS plugin stays, because an ESLint host can only load
//! JavaScript, and a conformance corpus keeps the two from drifting apart.

use std::io::Read;
use std::path::PathBuf;
use std::process::ExitCode;

use rayon::prelude::*;
use serde::Serialize;

mod config;
mod fix;
mod rules;
mod source;
mod suppression;
mod walk;

use config::{parse_severity, Config, Severity};
use fix::Fix;
use source::{analyze, check_file, Source};
use walk::collect_files;

/// Directories never worth walking, whatever the ignore files say: generated output and
/// dependencies dwarf the sources and hold code nobody in this project is going to fix.
const NEVER_WALK: [&str; 4] = ["node_modules", "dist", "target", "worktrees"];

/// The exit code for "the linter itself failed", as distinct from "the linter found problems".
/// CI has to tell a broken tool from a failing check; today both would look like a plain failure.
const EXIT_BROKEN: u8 = 2;

/// Bump this whenever the contract between the JS bridge and this binary changes: CLI flags,
/// accepted config keys/shape, or rule ids.
const PROTOCOL: u32 = 1;

pub const USAGE: &str = "\
carburetor-lint [options] [paths...]

  --config <path>          configuration file; default ./.carburetorrc.json when present
  --rule <name>=<severity> override one rule's severity (error, warn, off)
  --format <human|json>    output format; default human
  --deny-warnings          fail the run on warnings too
  --keep-overlaps          keep no-function-in-render alongside the allocation rules
  --fix                    write every available fix to disk
  --fix-dry-run            print what --fix would change, without writing it
  --stdin <path>           lint standard input as this file instead of walking any path
  -V, --version            print version and protocol, then exit
  -h, --help               print this

Exit codes: 0 clean, 1 problems found, 2 the linter itself failed.";

/// The one line `--version` prints; tests assert on its shape.
fn version_line() -> String {
    format!(
        "carburetor-lint {} protocol {PROTOCOL}",
        env!("CARGO_PKG_VERSION")
    )
}

/// How many times `--fix` re-parses and re-runs the rules over one file before giving up. A fix
/// that keeps reporting itself is a bug in that rule, not a reason to hang the tool — this bounds
/// the damage to one file taking a little longer, never forever.
pub(crate) const MAX_FIX_PASSES: u32 = 10;

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
    /// Which half of `carburetor/require-module-function` reported, spelled the way the config
    /// option names the scopes: `"class"` for the member analysis, `"module"` for the nested-
    /// function analysis. `None` for every other rule, so the JSON stays exactly the conformance
    /// contract for them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
}

#[derive(Debug, PartialEq)]
enum Format {
    Human,
    Json,
}

/// Whether this run only reports, writes fixes to disk, or previews them without writing.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum FixMode {
    Report,
    Write,
    DryRun,
}

struct Options {
    paths: Vec<PathBuf>,
    format: Format,
    config: Option<PathBuf>,
    /// Severity overrides from the command line, applied over per-file config.
    overrides: Vec<(String, Severity)>,
    /// Whether a warning is enough to fail the run.
    deny_warnings: bool,
    /// Whether no-function-in-render stays beside the allocation rules instead of yielding.
    keep_overlaps: bool,
    fix_mode: FixMode,
    /// Lint standard input as this file instead of walking any path: the one way a host can
    /// have an unsaved buffer analyzed. Its diagnostics report under the given path.
    stdin: Option<PathBuf>,
}

/// Reads the command line. An unknown flag is an error rather than a warning: a typo'd flag that
/// only prints a note is a run that silently did something other than what was asked.
fn parse_options(arguments: Vec<String>) -> Result<Option<Options>, String> {
    let mut paths: Vec<PathBuf> = Vec::new();
    let mut format = Format::Human;
    let mut config: Option<PathBuf> = None;
    let mut overrides: Vec<(String, Severity)> = Vec::new();
    let mut deny_warnings = false;
    let mut keep_overlaps = false;
    let mut fix_mode = FixMode::Report;
    let mut stdin: Option<PathBuf> = None;

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
            "-V" | "--version" => {
                println!("{}", version_line());

                return Ok(None);
            }
            "--format" => {
                format = match value("--format")?.as_str() {
                    "json" => Format::Json,
                    "human" => Format::Human,
                    other => {
                        return Err(format!("unknown format {other:?}: expected human or json"))
                    }
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
            "--keep-overlaps" => keep_overlaps = true,
            "--fix" if fix_mode == FixMode::DryRun => {
                return Err("--fix and --fix-dry-run are mutually exclusive".to_string());
            }
            "--fix" => fix_mode = FixMode::Write,
            "--fix-dry-run" if fix_mode == FixMode::Write => {
                return Err("--fix and --fix-dry-run are mutually exclusive".to_string());
            }
            "--fix-dry-run" => fix_mode = FixMode::DryRun,
            "--stdin" => {
                let path = PathBuf::from(value("--stdin")?);

                if fix_mode != FixMode::Report {
                    return Err(
                        "--stdin cannot be combined with --fix or --fix-dry-run".to_string()
                    );
                }

                stdin = Some(path);
            }
            other if other.starts_with('-') => return Err(format!("unknown option {other}")),
            _ => paths.push(PathBuf::from(argument)),
        }
    }

    if stdin.is_some() && !paths.is_empty() {
        return Err("--stdin replaces the paths; pass no directories or files with it".to_string());
    }

    if paths.is_empty() && stdin.is_none() {
        paths.push(PathBuf::from("."));
    }

    Ok(Some(Options {
        paths,
        format,
        config,
        overrides,
        deny_warnings,
        keep_overlaps,
        fix_mode,
        stdin,
    }))
}

fn report(diagnostics: &[Diagnostic], format: &Format) {
    if *format == Format::Json {
        let encoded =
            serde_json::to_string_pretty(diagnostics).unwrap_or_else(|_| "[]".to_string());

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
        config
            .override_rule(rule, *severity)
            .map_err(|error| error.to_string())?;
    }

    if let Some(path) = &options.stdin {
        let mut text = String::new();

        std::io::stdin()
            .read_to_string(&mut text)
            .map_err(|error| format!("could not read standard input: {error}"))?;

        // A buffer that does not parse is the editor's or compiler's problem to describe;
        // report nothing rather than half a diagnosis.
        let mut effective = config.overrides_for(path);
        for (rule, severity) in &options.overrides {
            effective
                .override_rule(rule, *severity)
                .map_err(|error| error.to_string())?;
        }
        let mut diagnostics: Vec<Diagnostic> =
            analyze(path, &text, &effective, options.keep_overlaps)
                .unwrap_or_default()
                .into_iter()
                .map(|mut diagnostic| {
                    diagnostic.file = path.to_string_lossy().replace('\\', "/");
                    diagnostic
                })
                .collect();

        sort_diagnostics(&mut diagnostics);

        return Ok(diagnostics);
    }

    let files = collect_files(&options.paths, config.ignores())?;

    let mut diagnostics: Vec<Diagnostic> = match options.fix_mode {
        FixMode::Report => files
            .par_iter()
            .map(|path| {
                let mut effective = config.overrides_for(path);
                for (rule, severity) in &options.overrides {
                    effective
                        .override_rule(rule, *severity)
                        .map_err(|error| error.to_string())?;
                }
                check_file(path, &effective, options.keep_overlaps)
            })
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .flatten()
            .collect(),
        FixMode::Write | FixMode::DryRun => fix::run_fix(
            &files,
            &config,
            options.fix_mode,
            &options.overrides,
            options.keep_overlaps,
        )?,
    };

    sort_diagnostics(&mut diagnostics);

    Ok(diagnostics)
}

/// The one report order, shared by file runs and `--stdin`: file, line, column, rule.
fn sort_diagnostics(diagnostics: &mut [Diagnostic]) {
    diagnostics.sort_by(|left, right| {
        (&left.file, left.line, left.column, &left.rule).cmp(&(
            &right.file,
            right.line,
            right.column,
            &right.rule,
        ))
    });
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

    #[test]
    fn version_line_has_the_documented_shape() {
        let line = version_line();

        assert!(line.starts_with("carburetor-lint "), "got {line:?}");
        assert!(line.contains(" protocol 1"), "got {line:?}");
        assert!(!line.ends_with('\n'));

        let fields: Vec<&str> = line.split_whitespace().collect();
        assert_eq!(fields.len(), 4);
        assert_eq!(fields[2], "protocol");
        // The cargo version is whatever the manifest says; just require it is non-empty.
        assert!(!fields[1].is_empty());
    }

    #[test]
    fn protocol_starts_at_one() {
        assert_eq!(PROTOCOL, 1);
    }

    #[test]
    fn version_flag_short_circuits_before_paths() {
        // Both spellings: like `--help`, printing the version means no paths were consumed.
        // `Options` is not `Debug`, so assert without comparing whole values.
        for flag in ["--version", "-V"] {
            assert!(
                matches!(
                    parse_options(vec!["carburetor-lint".into(), flag.into()]),
                    Ok(None)
                ),
                "{flag} should print the version and exit"
            );
        }
    }
}
