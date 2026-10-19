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

/// An arrow pyramid of the given depth, each level reading the module constant `base`.
fn arrow_pyramid(depth: usize) -> String {
    let mut text = String::from("const base = 0; const p = ");
    for _ in 0..depth {
        text.push_str("() => { base; return ");
    }
    text.push_str("0;");
    for _ in 0..depth {
        text.push_str(" }");
    }
    text.push(';');
    text
}

/// A function pyramid of the given depth, each level reading `base` and returning the next.
fn function_pyramid(depth: usize) -> String {
    let mut text = String::from("const base = 0; ");
    for level in 1..=depth {
        text.push_str(&format!("function f{level}() {{ base; "));
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
    for (name, pyramid) in [
        ("arrow", arrow_pyramid as fn(usize) -> String),
        ("function", function_pyramid),
    ] {
        let visits = |depth: usize| scan_reference_visits(&pyramid(depth));
        let small = visits(4);
        let medium = visits(8);
        let large = visits(12);

        assert!(
            small > 0,
            "{name} pyramid: no references visited at depth 4"
        );
        assert!(
            large < 6 * small,
            "{name} pyramid: {large} at depth 12 vs 6 x {small} at depth 4"
        );
        assert!(
            small <= medium && medium <= large,
            "{name} pyramid: {small} / {medium} / {large} is not monotone"
        );
    }
}
