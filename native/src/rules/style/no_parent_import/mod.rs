//! Reports an import that reaches up out of its directory, and rewrites it to the alias.
//!
//! `../../Models/Paths` tells a reader nothing about where the module lives and changes meaning
//! when the file moves; `@/Carburetor/Models/Paths` is the same module named from the root of the
//! source tree. Sideways and downward imports (`./x`, `./sub/x`) stay relative, because there the
//! relative path *is* the information.
//!
//! The source roots come from the rule's `roots` option — each entry a `{path, prefix}` pair.
//! With no configured roots the rule reports nothing: without knowing where a tree starts, an
//! upward import has no aliased form to offer, and an import that leaves every known tree — a
//! benchmark reaching into `dist`, say — is left alone rather than reported with no way forward.
//!
//! The fix keeps the original quote style, so it agrees with whatever formatter owns the file,
//! and escapes the kept quote and backslashes in the value.

use oxc_ast::ast::{Program, StringLiteral};

use crate::config::ImportRoot;
use crate::fix::Fix;
use crate::rules::report_with_fix;
use crate::rules::support::bases::Bases;
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/no-parent-import";

/// Resolves a relative specifier against the importing file, in posix form.
fn resolve_from(filename: &str, specifier: &str) -> String {
    let filename = filename.replace('\\', "/");
    let mut segments: Vec<&str> = filename.split('/').collect();

    segments.pop();

    for part in specifier.split('/') {
        if part == ".." {
            segments.pop();
        } else if part != "." {
            segments.push(part);
        }
    }

    segments.join("/")
}

/// A string literal in the given quote style, escaping the quote and backslashes in the value.
fn quoted(value: &str, quote: char) -> String {
    let mut out = String::with_capacity(value.len() + 2);

    out.push(quote);
    for character in value.chars() {
        if character == '\\' {
            out.push_str("\\\\");
        } else {
            if character == quote {
                out.push('\\');
            }
            out.push(character);
        }
    }
    out.push(quote);

    out
}

/// The aliased form of a resolved path, when it lands inside one of the source roots. The
/// JavaScript rule matches `(?:^|/)root.path/`; this walks candidate positions by hand.
fn to_alias(resolved: &str, roots: &[ImportRoot]) -> Option<String> {
    for root in roots {
        let marker = format!("{}/", root.path);
        let mut from = 0usize;

        while let Some(found) = resolved[from..].find(&marker) {
            let index = from + found;

            if index == 0 || resolved.as_bytes()[index - 1] == b'/' {
                return Some(format!(
                    "{}{}",
                    root.prefix,
                    &resolved[index + marker.len()..]
                ));
            }

            from = index + 1;
        }
    }

    None
}

/// Whether the literal was written in single quotes, so the fix keeps the author's style.
fn quote_of(literal: &StringLiteral<'_>) -> char {
    match literal
        .raw
        .as_ref()
        .and_then(|raw| raw.as_str().chars().next())
    {
        Some('\'') => '\'',
        _ => '"',
    }
}

/// Reports one module specifier that reaches up out of its directory.
fn check_source(
    source: &Source,
    literal: &StringLiteral<'_>,
    roots: &[ImportRoot],
    diagnostics: &mut Vec<Diagnostic>,
) {
    let specifier = literal.value.as_str();

    if !specifier.starts_with("../") {
        return;
    }

    let filename = source.path.to_string_lossy();
    let alias = to_alias(&resolve_from(&filename, specifier), roots);

    let Some(alias) = alias else {
        return;
    };

    // Keeps the original quote style, so the fix agrees with whatever formatter owns the file.
    let fix = Fix {
        start: literal.span.start,
        end: literal.span.end,
        text: quoted(&alias, quote_of(literal)),
    };

    diagnostics.push(report_with_fix(
        source,
        literal.span.start,
        RULE,
        format!(
            "\"{specifier}\" reaches up out of this directory. Import it as \"{alias}\", \
             which names the module from the root of the source tree and survives the file \
             being moved."
        ),
        Some(fix),
    ));
}

/// Runs the rule over one parsed file with no configured roots, where it reports nothing.
pub fn check(program: &Program<'_>, source: &Source, _bases: &Bases) -> Vec<Diagnostic> {
    check_with_options(program, source, &[])
}

/// Runs the rule at explicit roots; the config supplies the defaults or its overrides.
pub(in crate::rules) fn check_with_options<'a>(
    program: &'a Program<'a>,
    source: &Source<'a>,
    roots: &[ImportRoot],
) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();

    for statement in &program.body {
        match statement {
            oxc_ast::ast::Statement::ImportDeclaration(import) => {
                check_source(source, &import.source, roots, &mut diagnostics);
            }
            // `export ... from`, the re-export forms.
            oxc_ast::ast::Statement::ExportFromDeclaration(export) => {
                check_source(source, &export.source, roots, &mut diagnostics);
            }
            oxc_ast::ast::Statement::ExportAllDeclaration(export) => {
                check_source(source, &export.source, roots, &mut diagnostics);
            }
            _ => {}
        }
    }

    diagnostics
}

#[cfg(test)]
mod tests;
