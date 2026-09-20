//! The rule registry, and the machinery every rule shares.

use oxc_ast::ast::Program;

use crate::{Diagnostic, Source};

mod no_lifecycle_class_property;

/// Turns a byte offset into a 1-based line and column, the way an editor counts them.
pub fn locate(text: &str, offset: u32) -> (usize, usize) {
    let limit = (offset as usize).min(text.len());
    let before = &text[..limit];
    let line = before.matches('\n').count() + 1;
    let column = before.rsplit('\n').next().map_or(0, |last| last.chars().count()) + 1;

    (line, column)
}

/// Builds a diagnostic at a source offset.
pub fn report(source: &Source, offset: u32, rule: &str, message: String) -> Diagnostic {
    let (line, column) = locate(source.text, offset);

    Diagnostic {
        file: source.path.to_string_lossy().replace('\\', "/"),
        line,
        column,
        rule: rule.to_string(),
        message,
    }
}

/// Runs every rule over one parsed file.
pub fn run(program: &Program<'_>, source: &Source) -> Vec<Diagnostic> {
    let mut diagnostics: Vec<Diagnostic> = Vec::new();

    diagnostics.extend(no_lifecycle_class_property::check(program, source));

    diagnostics
}
