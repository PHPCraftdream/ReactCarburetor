//! Reports lines longer than the limit, measuring a tab as advancing to the next tab stop.
//!
//! `ignoreStrings` defaults to true, deliberately unlike eslint's false: this repository's demo
//! already has nine lines over 120, all JSX string-literal attributes — long Tailwind
//! `className` lists and one SVG path `d` — and wrapping them would make class lists
//! ungreppable and inflate diffs for zero readability gain. A separate task enables this rule
//! repo-wide; it is meant to police logic lines, not class lists.
//!
//! The check is a line scan over the file's own text, not an AST walk: a line's meaning does not
//! depend on what surrounds it, only on its own bytes. A quote inside a comment is prose, not a
//! string, so the scanner tracks both comment forms; an accepted approximation is that `//`
//! reads as a comment everywhere, which misreads division followed by a regex — good enough for
//! a style rule.

use oxc_ast::ast::Program;

use crate::config::MaxLineLengthOptions;
use crate::rules::report;
use crate::rules::support::bases::Bases;
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/max-line-length";

/// The column a tab advances to: the next multiple of the tab width, never a fraction of one.
fn next_tab_stop(column: u32, tab_width: u32) -> u32 {
    column + tab_width - (column % tab_width)
}

/// The line's length as displayed, with each tab stretched out to its tab stop.
fn expanded_length(line: &str, tab_width: u32) -> u32 {
    let mut column = 0;

    for character in line.chars() {
        column = if character == '\t' {
            next_tab_stop(column, tab_width)
        } else {
            column + 1
        };
    }

    column
}

/// The raw index of the character displayed at `column` — for a line over the limit, the first
/// character that is.
fn index_at_column(line: &str, column: u32, tab_width: u32) -> usize {
    let mut current = 0;

    for (index, character) in line.char_indices() {
        let next = if character == '\t' {
            next_tab_stop(current, tab_width)
        } else {
            current + 1
        };

        if next > column {
            return index;
        }

        current = next;
    }

    line.len().saturating_sub(1)
}

/// A quote span in a single line, as raw byte indexes within the line.
struct StringRange {
    start: usize,
    end: usize,
    quote: char,
}

/// Finds the quote spans of one line. Tracks quotes, escapes and both comment forms, because a
/// quote inside a comment is prose, not a string; an unterminated block comment runs to the end
/// of the line, and so does an unterminated quote — a template spanning lines is out of scope,
/// only its opening line is covered. `//` is treated as a comment everywhere, which misreads
/// division followed by a regex, an accepted approximation for a style rule.
fn scan_strings(line: &str) -> Vec<StringRange> {
    let bytes = line.as_bytes();
    let mut ranges = Vec::new();
    let mut quote: Option<char> = None;
    let mut start = 0usize;
    let mut escaped = false;
    let mut in_line_comment = false;
    let mut in_block_comment = false;

    for (index, character) in line.char_indices() {
        if in_line_comment {
            break;
        }

        if in_block_comment {
            if character == '/' && index > 0 && bytes[index - 1] == b'*' {
                in_block_comment = false;
            }

            continue;
        }

        if let Some(open) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == open {
                ranges.push(StringRange {
                    start,
                    end: index,
                    quote: open,
                });
                quote = None;
            }

            continue;
        }

        if character == '/' && bytes.get(index + 1) == Some(&b'/') {
            in_line_comment = true;
        } else if character == '/' && bytes.get(index + 1) == Some(&b'*') {
            in_block_comment = true;
        } else if character == '\'' || character == '"' || character == '`' {
            quote = Some(character);
            start = index;
            escaped = false;
        }
    }

    if let Some(open) = quote {
        ranges.push(StringRange {
            start,
            end: line.len().saturating_sub(1),
            quote: open,
        });
    }

    ranges
}

/// Runs the rule over one parsed file at the default options.
pub fn check(program: &Program<'_>, source: &Source, _bases: &Bases) -> Vec<Diagnostic> {
    check_with_options(program, source, &MaxLineLengthOptions::default())
}

/// Runs the rule at explicit options; the config supplies the defaults or its overrides.
pub(in crate::rules) fn check_with_options(
    _program: &Program<'_>,
    source: &Source,
    options: &MaxLineLengthOptions,
) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    // A line's span starts where the previous one ended; the newline belongs to the line it
    // terminates, the same split the JavaScript rule performs over the file text.
    let mut offset = 0u32;

    for (index, raw_line) in source.text.split('\n').enumerate() {
        let start = offset;
        offset = start + raw_line.len() as u32 + 1;

        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        let length = expanded_length(line, options.tab_width);

        if length <= options.code {
            continue;
        }

        // A URL cannot be wrapped, and a line the author marked exempt stays exempt.
        if options.ignore_urls && (line.contains("https://") || line.contains("http://")) {
            continue;
        }

        if options
            .ignore_pattern
            .as_ref()
            .is_some_and(|pattern| pattern.is_match(line))
        {
            continue;
        }

        // The first character past the limit decides what pushed the line over: a literal the
        // author cannot shorten without changing the code is skipped.
        let at = index_at_column(line, options.code, options.tab_width);
        let caused_by_string = scan_strings(line).iter().any(|range| {
            at >= range.start
                && at <= range.end
                && if range.quote == '`' {
                    options.ignore_template_literals
                } else {
                    options.ignore_strings
                }
        });

        if caused_by_string {
            continue;
        }

        // The report sits on the line itself, at its first column.
        diagnostics.push(report(
            source,
            start,
            RULE,
            format!(
                "Line {} is {} characters long; the maximum is {}.",
                index + 1,
                length,
                options.code
            ),
        ));
    }

    diagnostics
}

#[cfg(test)]
mod tests;
