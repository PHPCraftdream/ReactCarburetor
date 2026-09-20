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

use ignore::WalkBuilder;
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;
use rayon::prelude::*;
use serde::Serialize;

mod rules;

/// One reported problem, in the shape both output formats and the conformance corpus use.
#[derive(Debug, Serialize)]
pub struct Diagnostic {
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub rule: String,
    pub message: String,
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
}

fn parse_options(arguments: Vec<String>) -> Options {
    let mut paths: Vec<PathBuf> = Vec::new();
    let mut format = Format::Human;

    for argument in arguments.into_iter().skip(1) {
        match argument.as_str() {
            "--format=json" => format = Format::Json,
            "--format=human" => format = Format::Human,
            other if other.starts_with("--") => eprintln!("carburetor-lint: ignoring {other}"),
            other => paths.push(PathBuf::from(other)),
        }
    }

    if paths.is_empty() {
        paths.push(PathBuf::from("."));
    }

    Options { paths, format }
}

/// Files worth parsing: TypeScript and JavaScript, minus whatever the ignore files exclude.
fn collect_files(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = Vec::new();

    for root in paths {
        for entry in WalkBuilder::new(root).hidden(false).build().flatten() {
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

    files
}

/// Parses one file and runs every rule over it. Parse errors are left to the compiler to report.
fn check_file(path: &Path) -> Vec<Diagnostic> {
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

    rules::run(&parsed.program, &source)
}

fn report(diagnostics: &[Diagnostic], format: &Format) {
    if *format == Format::Json {
        let encoded = serde_json::to_string_pretty(diagnostics).unwrap_or_else(|_| "[]".to_string());

        println!("{encoded}");

        return;
    }

    for diagnostic in diagnostics {
        println!(
            "{}:{}:{}: {} — {}",
            diagnostic.file, diagnostic.line, diagnostic.column, diagnostic.rule, diagnostic.message
        );
    }

    if diagnostics.is_empty() {
        println!("carburetor-lint: no problems found");
    }
}

fn main() -> ExitCode {
    let options = parse_options(std::env::args().collect());
    let files = collect_files(&options.paths);

    // One task per file: parsing dominates the work and is embarrassingly parallel.
    let mut diagnostics: Vec<Diagnostic> = files
        .par_iter()
        .flat_map(|path| check_file(path))
        .collect();

    diagnostics.sort_by(|left, right| {
        (&left.file, left.line, left.column).cmp(&(&right.file, right.line, right.column))
    });

    report(&diagnostics, &options.format);

    if diagnostics.is_empty() {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}
