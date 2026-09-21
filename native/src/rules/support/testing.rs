//! What a rule's unit tests need: parse a snippet, run one rule, look at what it reported.

use std::path::Path;

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

use crate::{Diagnostic, Source};

/// Runs one rule over a TSX snippet and returns what it reported.
///
/// TSX for every test, because it is the superset the real files are written in — a rule that only
/// works on plain TypeScript would pass its tests and then miss half the components.
pub fn diagnose(
    text: &str,
    check: fn(&oxc_ast::ast::Program<'_>, &Source<'_>) -> Vec<Diagnostic>,
) -> Vec<Diagnostic> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();

    assert!(parsed.diagnostics.is_empty(), "test source must parse: {:?}", parsed.diagnostics);

    let path = Path::new("fixture.tsx");
    let source = Source { path, text };

    check(&parsed.program, &source)
}

/// The 1-based lines a rule reported on, in order — what a test asserts against.
pub fn lines(diagnostics: &[Diagnostic]) -> Vec<usize> {
    diagnostics.iter().map(|diagnostic| diagnostic.line).collect()
}
