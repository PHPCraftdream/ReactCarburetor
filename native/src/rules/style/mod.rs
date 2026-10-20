//! The house style rules: line length, TSDoc shape, and imports that name their modules from
//! the source tree's root.
//!
//! These rules are opt-in (`Severity::Off` by default): they police the repository's own style
//! rather than correctness, and a consumer turns the ones it wants on in `.carburetorrc.json`.

pub(crate) mod max_line_length;
pub(crate) mod no_blank_line_after_tsdoc;
pub(crate) mod no_parent_import;
pub(crate) mod require_tsdoc;
pub(crate) mod tsdoc_blank_line_before_tags;

use oxc_ast::ast::{Comment, Program};

/// The last comment that sits directly above `offset`, separated from it by nothing but
/// whitespace — the comment a TSDoc rule reads as the declaration's documentation.
///
/// This is `getCommentsBefore` narrowed to what the style rules need: the JavaScript host
/// returns every comment chained before a node with only whitespace between them, and the rules
/// take the last one. Comments arrive sorted by span start, so one binary search finds the
/// nearest previous one, and it is the only candidate: the nearest previous comment is the last
/// of any whitespace-separated chain, so if its end does not touch `offset`, no earlier one does.
pub(crate) fn comment_before<'a>(
    program: &'a Program<'a>,
    text: &str,
    offset: u32,
) -> Option<&'a Comment> {
    // The nearest comment starting before `offset`; its end is checked rather than assumed,
    // since a comment only ends before the next token.
    let index = program
        .comments
        .partition_point(|comment| comment.span.start < offset);
    let comment = program.comments.get(index.checked_sub(1)?)?;

    if comment.span.end <= offset
        && text[comment.span.end as usize..offset as usize]
            .trim()
            .is_empty()
    {
        Some(comment)
    } else {
        None
    }
}
