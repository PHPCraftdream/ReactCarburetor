//! The redesigned scan against its oracle: same findings on every corpus source, and a visit
//! count that grows with the nesting depth instead of its square.

use std::path::Path;

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

use super::super::module_functions::{check, scan_reference_visits};
use super::oracle_scan::oracle_check;
use crate::config::ModuleFunctionScope;
use crate::rules::support::closures::build_semantic;
use crate::rules::support::closures::CORPUS;
use crate::{Diagnostic, Source};

const SCOPES: [ModuleFunctionScope; 2] = [ModuleFunctionScope::All, ModuleFunctionScope::Classes];

/// Runs one scope of one scan over `text`, as the rules see a file.
fn run(
    text: &str,
    scope: ModuleFunctionScope,
    oracle: bool,
) -> Vec<(usize, usize, Option<String>)> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();
    assert!(parsed.diagnostics.is_empty(), "corpus source must parse");
    let semantic = build_semantic(&parsed.program);
    let source = Source::new(Path::new("test.tsx"), text);
    let diagnostics: Vec<Diagnostic> = if oracle {
        oracle_check(&parsed.program, &semantic, &source, scope)
    } else {
        check(&parsed.program, &semantic, &source, scope)
    };

    diagnostics
        .into_iter()
        .map(|diagnostic| (diagnostic.line, diagnostic.column, diagnostic.scope))
        .collect()
}

#[test]
fn matches_oracle_on_corpus() {
    for (index, text) in CORPUS.iter().enumerate() {
        for scope in SCOPES {
            assert_eq!(
                run(text, scope, true),
                run(text, scope, false),
                "corpus[{index}] diverges from the oracle under {scope:?}: {text}"
            );
        }
    }
}

/// An arrow pyramid of the given depth, capturing nothing but its own chain.
fn arrow_pyramid(depth: usize) -> String {
    format!("const p = {}0;", "() => ".repeat(depth))
}

/// A function pyramid of the given depth, each level returning the next.
fn function_pyramid(depth: usize) -> String {
    let mut text = String::new();
    for level in 1..=depth {
        text.push_str(&format!("function f{level}() {{ "));
    }
    text.push_str("return 0; ");
    for level in (1..depth).rev() {
        text.push_str(&format!("return f{}; }} ", level + 1));
    }
    text.push('}');
    text
}

#[test]
fn visits_grow_linearly_with_depth() {
    let small_arrows = scan_reference_visits(&arrow_pyramid(4));
    let large_arrows = scan_reference_visits(&arrow_pyramid(12));
    let small_functions = scan_reference_visits(&function_pyramid(4));
    let large_functions = scan_reference_visits(&function_pyramid(12));

    assert!(
        large_arrows < 6 * small_arrows,
        "arrow pyramid: {large_arrows} vs 6 x {small_arrows}"
    );
    assert!(
        large_functions < 6 * small_functions,
        "function pyramid: {large_functions} vs 6 x {small_functions}"
    );
}
