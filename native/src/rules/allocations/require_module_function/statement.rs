use std::collections::HashMap;

use crate::rules::locate;
use oxc_ast::ast::{Comment, Declaration, ExportDefaultDeclarationKind, Program, Statement};
use oxc_span::{GetSpan, Span};

/// The class statement a member would be extracted out of: the range the fix replaces, from the
/// statement's first token — its `export` keyword, a decorator, `abstract` — and its leading
/// comments through the class's last byte, so the function can go above all of it.
#[derive(Clone, Copy)]
pub(super) struct StatementFix {
    pub(super) start: u32,
    pub(super) end: u32,
}

/// The top-level class statements a member can be extracted from, keyed by the class's span:
/// §7.3 allows the move only when the class stands directly in `Program.body`, or is the
/// declaration of an `export` / `export default`. A nested or expression-position class is not
/// in the map, which is what makes its members report without a fix.
pub(super) fn top_level_class_statements(program: &Program<'_>) -> HashMap<Span, StatementFix> {
    let mut statements = HashMap::new();

    for statement in &program.body {
        let class = match statement {
            Statement::ClassDeclaration(class) => class,
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::ClassDeclaration(class) => class,
                _ => continue,
            },
            Statement::ExportDefaultDeclaration(export) => match &export.declaration {
                ExportDefaultDeclarationKind::ClassDeclaration(class) => class,
                _ => continue,
            },
            _ => continue,
        };

        let mut start = statement.span().start.min(class.span.start);

        // `class.span` need not reach back over the decorators, so take them by hand.
        for decorator in &class.decorators {
            start = start.min(decorator.span.start);
        }

        // The function goes above the class's own leading comments, so they are part of the
        // replaced range — and survive byte for byte inside it.
        if let Some((comments_start, _)) = leading_comments(program, program.source_text, start) {
            start = start.min(comments_start);
        }

        statements.insert(
            class.span,
            StatementFix {
                start,
                end: class.span.end,
            },
        );
    }

    statements
}

/// The start offset of the line `offset` sits on.
pub(super) fn line_start(source: &str, offset: u32) -> u32 {
    let offset = (offset as usize).min(source.len());
    source[..offset]
        .rfind('\n')
        .map_or(0, |index| index as u32 + 1)
}

/// Whether a comment leads its own line: nothing but whitespace sits between the line's start
/// and the comment, so the whole line is the comment's to move.
fn leads_own_line(source: &str, comment: &Comment) -> bool {
    source[line_start(source, comment.span.start) as usize..comment.span.start as usize]
        .trim()
        .is_empty()
}

/// The leading-comment block above `offset`, as the byte range from the first comment's line
/// start to the last comment's last byte: line-leading comments ending on the line directly
/// above `offset` — a TSDoc above a member, a `//` note above a class — chained upward as far
/// as the block goes. A line-leading comment sharing `offset`'s own line, with only whitespace
/// between it and `offset`, counts too, so a note sitting beside the member's first line moves
/// with the extraction instead of dying with the member's line. `None` when there is none.
pub(super) fn leading_comments(
    program: &Program<'_>,
    source: &str,
    offset: u32,
) -> Option<(u32, u32)> {
    let offset_line = locate(source, offset).0;

    let ends_above = |comment: &Comment| {
        let end_line = locate(source, comment.span.end).0;

        end_line + 1 == offset_line
            || (end_line == offset_line
                && comment.span.end <= offset
                && source[comment.span.end as usize..offset as usize]
                    .trim()
                    .is_empty())
    };

    let mut closest = program
        .comments
        .iter()
        .filter(|comment| leads_own_line(source, comment) && ends_above(comment))
        .map(|comment| comment.span)
        .min_by_key(|span: &Span| span.start)?;

    let mut line = locate(source, closest.start).0;

    while let Some(comment) = program.comments.iter().find(|comment| {
        leads_own_line(source, comment) && locate(source, comment.span.end).0 + 1 == line
    }) {
        line = locate(source, comment.span.start).0;
        closest = comment.span;
    }

    Some((line_start(source, closest.start), closest.end))
}
