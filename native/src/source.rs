//! The per-file inputs the rules run over, and the one parse-and-run step both modes share.

use std::fs;
use std::path::Path;

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

use crate::config::Config;
use crate::suppression::Suppression;
use crate::{rules, Diagnostic};

/// What a rule receives: the parsed file, and where it came from.
pub struct Source<'a> {
    pub path: &'a Path,
    pub text: &'a str,
    line_table: rules::LineTable,
}

impl<'a> Source<'a> {
    /// Builds the source and indexes its lines once, for every diagnostic it will produce.
    pub fn new(path: &'a Path, text: &'a str) -> Source<'a> {
        Source {
            path,
            text,
            line_table: rules::LineTable::new(text),
        }
    }

    /// The file's prebuilt line index.
    pub fn line_table(&self) -> &rules::LineTable {
        &self.line_table
    }
}

/// Parses `text` as if it were `path`'s content and runs the rules the config leaves on, dropping
/// what a directive silences. `None` means the parser could not make sense of it — a half-built
/// tree is the compiler's problem to report, not ours, and (for `--fix`) a signal that whatever
/// produced this text broke it and should not be trusted.
pub fn analyze(
    path: &Path,
    text: &str,
    config: &Config,
    keep_overlaps: bool,
) -> Option<Vec<Diagnostic>> {
    let source_type = SourceType::from_path(path).unwrap_or_default();
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, source_type).parse();

    if !parsed.diagnostics.is_empty() {
        return None;
    }

    let source = Source::new(path, text);
    let suppression = Suppression::build(&parsed.program);

    Some(
        rules::run(&parsed.program, &source, config, keep_overlaps)
            .into_iter()
            .filter(|diagnostic| !suppression.silenced(&diagnostic.rule, diagnostic.line))
            .collect(),
    )
}

/// Reads and analyzes one file from disk; read failures retain the path for the run-level error.
pub fn check_file(
    path: &Path,
    config: &Config,
    keep_overlaps: bool,
) -> Result<Vec<Diagnostic>, String> {
    let text = fs::read_to_string(path)
        .map_err(|error| format!("could not read {}: {error}", path.display()))?;

    Ok(analyze(path, &text, config, keep_overlaps).unwrap_or_default())
}

