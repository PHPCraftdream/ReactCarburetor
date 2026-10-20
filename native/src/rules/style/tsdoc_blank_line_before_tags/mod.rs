//! Requires exactly one blank line between a TSDoc description and its first block tag, and
//! fixes any other count to one.
//!
//! The blank line is what separates the prose a reader skims from the reference list below it; a
//! doc with none runs the two together, and a doc with several leaves a hole that looks like a
//! forgotten paragraph. The fix keeps the tag line's own `*` column for the inserted line.

use oxc_ast::ast::Program;

use crate::fix::Fix;
use crate::rules::report_with_fix;
use crate::rules::support::bases::Bases;
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/tsdoc-blank-line-before-tags";

/// A block tag at the start of a TSDoc line: `@param`, `@returns`, `@see`…
fn is_block_tag(content: &str) -> bool {
    let mut characters = content.chars();

    characters.next() == Some('@')
        && characters
            .next()
            .is_some_and(|letter| letter.is_ascii_alphabetic())
}

/// Whether a line opens or closes a Markdown code fence, inside which a line starting with `@`
/// is code, not a tag.
fn is_fence(content: &str) -> bool {
    content.starts_with("```") || content.starts_with("~~~")
}

/// What a TSDoc line says once its decoration is gone: the leading `/**` or `*` and one space.
fn content_of(line: &str) -> &str {
    let mut current = line.trim_start();

    if let Some(rest) = current.strip_prefix("/**") {
        current = rest;
    } else if let Some(rest) = current.strip_prefix('*') {
        // `*/` closes the comment; its star is decoration of a different kind.
        if !rest.starts_with('/') {
            current = rest;
        }
    }

    let trimmed = current.trim_end();
    let without_close = trimmed.strip_suffix("*/").unwrap_or(trimmed);

    without_close.trim()
}

/// Where the description ends and the first block tag starts, when the comment has both:
/// the line indexes of the last description line and of the first tag line.
fn find_sections(lines: &[&str]) -> Option<(usize, usize)> {
    let mut in_fence = false;
    let mut last_description: Option<usize> = None;

    for (index, line) in lines.iter().enumerate() {
        let content = content_of(line);

        if is_fence(content) {
            in_fence = !in_fence;
        }

        if !in_fence && is_block_tag(content) {
            return last_description.map(|last| (last, index));
        }

        if !content.is_empty() {
            last_description = Some(index);
        }
    }

    None
}

/// Runs the rule over one parsed file.
pub fn check(program: &Program<'_>, source: &Source, _bases: &Bases) -> Vec<Diagnostic> {
    let text = source.text;
    let mut diagnostics = Vec::new();

    for comment in &program.comments {
        if comment.is_line() {
            continue;
        }

        let raw = &text[comment.span.start as usize..comment.span.end as usize];

        if !raw.starts_with("/**") {
            continue;
        }

        let lines: Vec<&str> = raw.split('\n').collect();
        let Some((last_description, first_tag)) = find_sections(&lines) else {
            continue;
        };

        let blanks = first_tag - last_description - 1;

        if blanks == 1 {
            continue;
        }

        // The tag line's own `*` column decides where the inserted blank line's star sits.
        let star = lines[first_tag].find('*').map_or(0, |index| index + 1);
        let blank_line = &lines[first_tag][..star];

        // Description, exactly one blank line, then the tags; any other blank count between
        // them — none, or several — is rewritten to this shape.
        let mut parts: Vec<&str> = lines[..=last_description].to_vec();
        parts.push(blank_line);
        parts.extend_from_slice(&lines[first_tag..]);
        let fixed = parts.join("\n");

        let message = if blanks == 0 {
            String::from("Add one blank line between the TSDoc description and its first tag.")
        } else {
            format!(
                "Keep exactly one blank line between the TSDoc description and its first tag, \
                 not {blanks}."
            )
        };

        diagnostics.push(report_with_fix(
            source,
            comment.span.start,
            RULE,
            message,
            Some(Fix {
                start: comment.span.start,
                end: comment.span.end,
                text: fixed,
            }),
        ));
    }

    diagnostics
}
