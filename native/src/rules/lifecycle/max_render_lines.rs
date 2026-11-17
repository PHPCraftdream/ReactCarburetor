//! A `render()` longer than the configured number of lines (30 by default).
//!
//! A long render mixes every part of the component's output in one method: the header, the rows,
//! the empty state and the footer are read, reviewed and changed as one block. Split it into methods
//! of the component (`renderHeader()`, `renderRow(item)`), each short enough to read at once, and let
//! `render()` assemble them.
//!
//! Counted are the lines of the method's body, between its braces, that hold code: blank lines and
//! lines holding only comments do not count. Every `render` method of a class that extends
//! something is checked; function components are not, since a component here is a class.

use oxc_ast::ast::{Class, ClassElement, MethodDefinition, MethodDefinitionKind, Program};
use oxc_ast_visit::{walk, Visit};
use oxc_span::{GetSpan, Span};

use crate::rules::report;
use crate::rules::support::bases::Bases;
use crate::rules::support::names::property_key_name;
use crate::{Diagnostic, Source};

/// The id this rule reports under; the registry keys its severity by it.
pub const RULE: &str = "carburetor/max-render-lines";

use crate::config::DEFAULT_RENDER_LINES as DEFAULT_MAX;

struct Check<'s> {
    source: &'s Source<'s>,
    comments: Vec<Span>,
    max: u32,
    diagnostics: Vec<Diagnostic>,
}

impl Check<'_> {
    /// The lines of `text[start..end]` holding something other than whitespace and comments.
    fn code_lines(&self, start: u32, end: u32) -> u32 {
        let text = self.source.text;
        let mut count = 0;
        let mut line_has_code = false;
        let mut comments = self
            .comments
            .iter()
            .filter(|comment| comment.end > start && comment.start < end)
            .peekable();

        let mut offset = start;
        for character in text[start as usize..end as usize].chars() {
            while comments.peek().is_some_and(|comment| comment.end <= offset) {
                comments.next();
            }
            let in_comment = comments
                .peek()
                .is_some_and(|comment| comment.start <= offset && offset < comment.end);
            if character == '\n' {
                count += u32::from(line_has_code);
                line_has_code = false;
            } else if !in_comment && !character.is_whitespace() {
                line_has_code = true;
            }
            offset += character.len_utf8() as u32;
        }

        count + u32::from(line_has_code)
    }

    fn method(&mut self, method: &MethodDefinition<'_>) {
        // A getter, a setter or a static `render` is not the component's render.
        if property_key_name(&method.key) != Some("render")
            || method.kind != MethodDefinitionKind::Method
            || method.r#static
        {
            return;
        }
        let Some(body) = &method.value.body else {
            return;
        };
        // Between the braces, which belong to the signature's lines, not the body's.
        let lines = self.code_lines(body.span.start + 1, body.span.end.saturating_sub(1));
        if lines > self.max {
            self.diagnostics.push(report(
                self.source,
                method.key.span().start,
                RULE,
                format!(
                    "render() holds {lines} lines of code, more than {}: move its parts into \
                     methods of the component (renderHeader(), renderRow(item)) and let render() \
                     assemble them.",
                    self.max
                ),
            ));
        }
    }
}

impl<'a> Visit<'a> for Check<'_> {
    fn visit_class(&mut self, class: &Class<'a>) {
        if class.heritage.is_some() {
            for element in &class.body.body {
                if let ClassElement::MethodDefinition(method) = element {
                    self.method(method);
                }
            }
        }

        walk::walk_class(self, class);
    }
}

/// The registry entry, at the default limit; the dispatch calls [`check_with_max`] with the
/// configured one.
pub fn check(program: &Program<'_>, source: &Source<'_>, bases: &Bases) -> Vec<Diagnostic> {
    check_with_max(program, source, bases, DEFAULT_MAX)
}

/// Runs the rule over one parsed file with a limit of `max` lines.
pub fn check_with_max(
    program: &Program<'_>,
    source: &Source<'_>,
    _bases: &Bases,
    max: u32,
) -> Vec<Diagnostic> {
    let mut check = Check {
        source,
        comments: program
            .comments
            .iter()
            .map(|comment| comment.span)
            .collect(),
        max,
        diagnostics: Vec::new(),
    };
    check.visit_program(program);
    check.diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::support::testing::{diagnose, lines};

    /// A component whose render holds `count` lines of code.
    fn component(count: usize) -> String {
        let rows: String = (0..count - 2)
            .map(|index| format!("            <li>{index}</li>\n"))
            .collect();
        format!(
            "class List extends AntiHookComponent {{\n    render() {{\n        return <ul>\n{rows}        </ul>;\n    }}\n}}\n"
        )
    }

    #[test]
    fn a_render_within_the_limit_is_clean() {
        assert!(diagnose(&component(30), check).is_empty());
    }

    #[test]
    fn a_render_past_the_limit_is_reported_at_its_name() {
        let found = diagnose(&component(31), check);

        assert_eq!(lines(&found), [2]);
        assert_eq!(found[0].column, 5);
        assert!(found[0]
            .message
            .contains("holds 31 lines of code, more than 30"));
    }

    #[test]
    fn blank_lines_and_comments_do_not_count() {
        let mut source = component(30);
        source = source.replace(
            "        return <ul>\n",
            "        // the list\n\n        /* several\n           lines */\n        return <ul> {/* inline */}\n",
        );

        assert!(diagnose(&source, check).is_empty());
    }

    #[test]
    fn a_line_with_code_after_a_comment_counts() {
        let source = component(30).replace(
            "        return <ul>\n",
            "        /* note */ const a = 1;\n        return <ul>\n",
        );

        assert_eq!(lines(&diagnose(&source, check)), [2]);
    }

    #[test]
    fn only_render_of_a_class_that_extends_something_is_checked() {
        let long = component(40);
        let plain = long.replace(" extends AntiHookComponent", "");
        let other = long.replace("render()", "renderRows()");

        assert!(diagnose(&plain, check).is_empty());
        assert!(diagnose(&other, check).is_empty());
        assert!(diagnose(&long.replace("render()", "static render()"), check).is_empty());
        assert!(diagnose(&long.replace("render()", "get render()"), check).is_empty());
    }

    #[test]
    fn the_limit_comes_from_the_config() {
        fn at_12(program: &Program<'_>, source: &Source<'_>, bases: &Bases) -> Vec<Diagnostic> {
            check_with_max(program, source, bases, 12)
        }
        fn at_11(program: &Program<'_>, source: &Source<'_>, bases: &Bases) -> Vec<Diagnostic> {
            check_with_max(program, source, bases, 11)
        }
        let source = component(12);

        assert!(diagnose(&source, at_12).is_empty());
        assert_eq!(lines(&diagnose(&source, at_11)), [2]);
    }
}
