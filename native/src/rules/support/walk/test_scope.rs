//! Test registration callbacks: the bodies a test runner calls once, not code that runs per render
//! or per call.
//!
//! `describe('x', () => { ... })`, `it(...)`, `beforeEach(...)` and the rest hand the runner a
//! function it calls a single time. The allocation and disposal rules reason about code that runs
//! again and again or lives as long as the process; inside such a callback neither holds, so a
//! rule drops what it found there. A registrar is recognised by its root name, through the chain
//! modifiers runners add (`it.only`, `describe.each(table)`, `test.concurrent.skip`), and only when
//! that name is a global or an import: a function the file itself declares under the same name is
//! ordinary code.

use oxc_ast::ast::{Argument, CallExpression, Expression, Program};
use oxc_ast::AstKind;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::Semantic;
use oxc_span::Span;

use crate::rules::support::names::{referenced_symbol, unwrap_expression};
use crate::{Diagnostic, Source};

/// The names test runners register suites, tests and hooks under.
const REGISTRARS: &[&str] = &[
    "describe",
    "it",
    "test",
    "suite",
    "bench",
    "beforeEach",
    "afterEach",
    "beforeAll",
    "afterAll",
    "before",
    "after",
    "xdescribe",
    "xit",
    "xtest",
    "fdescribe",
    "fit",
];

/// The chain members runners put between the registrar and the call.
const MODIFIERS: &[&str] = &[
    "only",
    "skip",
    "todo",
    "each",
    "concurrent",
    "sequential",
    "skipIf",
    "runIf",
    "fails",
    "failing",
    "for",
    "shuffle",
];

/// Whether the name a registrar chain starts from is the runner's: unresolved (a global the
/// runner provides) or an import, never a binding this file declares itself.
fn runner_name(expression: &Expression<'_>, semantic: &Semantic<'_>) -> bool {
    let Expression::Identifier(identifier) = expression else {
        return false;
    };

    if !REGISTRARS.contains(&identifier.name.as_str()) {
        return false;
    }

    match referenced_symbol(identifier, semantic) {
        None => true,
        Some(symbol) => matches!(
            semantic.symbol_declaration(symbol).kind(),
            AstKind::ImportSpecifier(_)
                | AstKind::ImportDefaultSpecifier(_)
                | AstKind::ImportNamespaceSpecifier(_)
        ),
    }
}

/// Whether `callee` names a registrar: `it`, `it.only.skip`, `describe.each(table)`,
/// `` describe.each`table` `` or `test.skipIf(condition)`.
fn is_registrar(callee: &Expression<'_>, semantic: &Semantic<'_>) -> bool {
    match unwrap_expression(callee) {
        Expression::StaticMemberExpression(member) => {
            MODIFIERS.contains(&member.property.name.as_str())
                && (runner_name(&member.object, semantic) || is_registrar(&member.object, semantic))
        }
        Expression::CallExpression(call) => is_registrar(&call.callee, semantic),
        Expression::TaggedTemplateExpression(tagged) => is_registrar(&tagged.tag, semantic),
        other => runner_name(other, semantic),
    }
}

/// Collects the spans of the functions handed to registrars, outermost first.
struct Collect<'s, 'a> {
    semantic: &'s Semantic<'a>,
    spans: Vec<Span>,
}

impl<'a> Visit<'a> for Collect<'_, 'a> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if !is_registrar(&call.callee, self.semantic) {
            walk::walk_call_expression(self, call);

            return;
        }

        // The whole callback is out of scope, so nothing nested in it needs a visit of its own.
        for argument in &call.arguments {
            if let Some(Expression::ArrowFunctionExpression(arrow)) = argument_expression(argument)
            {
                self.spans.push(arrow.span);
            } else if let Some(Expression::FunctionExpression(function)) =
                argument_expression(argument)
            {
                self.spans.push(function.span);
            }
        }
    }
}

/// The argument as an expression with its wrappers removed; a spread is not a callback.
fn argument_expression<'b>(argument: &'b Argument<'b>) -> Option<&'b Expression<'b>> {
    argument.as_expression().map(unwrap_expression)
}

/// The spans of every callback a test registrar was given in this file.
fn registrar_callbacks(program: &Program<'_>, semantic: &Semantic<'_>) -> Vec<Span> {
    let mut collect = Collect {
        semantic,
        spans: Vec::new(),
    };

    collect.visit_program(program);

    collect.spans
}

/// Drops the diagnostics of `rule` that lie inside a test registrar's callback.
///
/// Diagnostics carry a line and a column, not an offset, so each callback span is located the same
/// way `report` located the diagnostic and the two positions are compared as pairs.
pub fn retain_outside_tests(
    diagnostics: &mut Vec<Diagnostic>,
    rule: &str,
    program: &Program<'_>,
    semantic: &Semantic<'_>,
    source: &Source<'_>,
) {
    if !diagnostics.iter().any(|diagnostic| diagnostic.rule == rule) {
        return;
    }

    let callbacks = registrar_callbacks(program, semantic);

    if callbacks.is_empty() {
        return;
    }

    let table = source.line_table();
    let ranges: Vec<((usize, usize), (usize, usize))> = callbacks
        .iter()
        .map(|span| {
            (
                table.locate(source.text, span.start),
                table.locate(source.text, span.end),
            )
        })
        .collect();

    diagnostics.retain(|diagnostic| {
        let at = (diagnostic.line, diagnostic.column);

        diagnostic.rule != rule || !ranges.iter().any(|(start, end)| *start <= at && at < *end)
    });
}

#[cfg(test)]
mod tests {
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    use super::*;
    use crate::rules::support::closures::build_semantic;

    /// The callback spans of a snippet, as the source text each one covers.
    fn callbacks(text: &str) -> Vec<String> {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();
        let semantic = build_semantic(&parsed.program);

        registrar_callbacks(&parsed.program, &semantic)
            .iter()
            .map(|span| text[span.start as usize..span.end as usize].to_string())
            .collect()
    }

    #[test]
    fn globals_and_their_modifier_chains_are_registrars() {
        let found = callbacks(
            "describe('a', () => 1);\nit.only('b', function () { return 2; });\n\
             test.concurrent.skip('c', () => 3);\nbeforeEach(() => 4);",
        );

        assert_eq!(
            found,
            ["() => 1", "function () { return 2; }", "() => 3", "() => 4"]
        );
    }

    #[test]
    fn table_forms_are_registrars() {
        let found = callbacks(
            "describe.each([1, 2])('a %s', (n) => n);\ntest.each`a\n${1}`('b', ({a}) => a);\n\
             test.skipIf(true)('c', () => 3);",
        );

        assert_eq!(found, ["(n) => n", "({a}) => a", "() => 3"]);
    }

    #[test]
    fn an_imported_registrar_counts_and_a_local_one_does_not() {
        assert_eq!(
            callbacks("import {it as test} from 'vitest';\ntest('a', () => 1);"),
            ["() => 1"]
        );
        assert_eq!(
            callbacks("const it = (name: string, run: () => number) => run();\nit('a', () => 1);"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn an_unknown_member_is_not_a_modifier() {
        assert_eq!(
            callbacks("describe.custom('a', () => 1);\nother('b', () => 2);"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn nested_registrars_are_covered_by_the_outer_callback() {
        assert_eq!(
            callbacks("describe('a', () => { it('b', () => 1); });"),
            ["() => { it('b', () => 1); }"]
        );
    }
}
