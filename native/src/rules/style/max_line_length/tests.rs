use super::*;
use crate::config::MaxLineLengthOptions;
use crate::rules::support::testing::{diagnose, lines};
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;
use std::path::Path;

/// Runs the rule over a snippet at explicit options, since the options live outside `check`'s
/// fixed registry signature.
fn diagnose_options(text: &str, options: &MaxLineLengthOptions) -> Vec<Diagnostic> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, SourceType::tsx()).parse();

    assert!(
        parsed.diagnostics.is_empty(),
        "test source must parse: {:?}",
        parsed.diagnostics
    );

    let path = Path::new("fixture.tsx");
    let source = Source::new(path, text);

    check_with_options(&parsed.program, &source, options)
}

/// Options with one or two fields overridden from the JavaScript rule's defaults.
fn options(
    code: u32,
    tab_width: u32,
    ignore_urls: bool,
    ignore_pattern: Option<&str>,
    ignore_strings: bool,
    ignore_template_literals: bool,
) -> MaxLineLengthOptions {
    MaxLineLengthOptions {
        code,
        tab_width,
        ignore_urls,
        ignore_pattern: ignore_pattern.and_then(|pattern| regex::Regex::new(pattern).ok()),
        ignore_strings,
        ignore_template_literals,
    }
}

#[test]
fn a_line_exactly_at_the_default_limit_of_120_passes() {
    let source = format!("// {}", "x".repeat(117));

    assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
}

#[test]
fn one_character_past_the_default_limit_reports_on_line_one() {
    let source = format!("// {}", "x".repeat(118));

    let diagnostics = diagnose(&source, check);

    assert_eq!(lines(&diagnostics), [1]);
    assert_eq!(
        diagnostics[0].message,
        "Line 1 is 121 characters long; the maximum is 120."
    );
}

#[test]
fn a_long_url_in_a_comment_passes_under_ignore_urls() {
    let source = format!("// documented at https://example.com/{}", "a".repeat(120));
    let configured = options(120, 4, true, None, true, false);

    assert_eq!(
        lines(&diagnose_options(&source, &configured)),
        [] as [usize; 0]
    );
}

#[test]
fn a_long_url_reports_without_ignore_urls() {
    let source = format!("// documented at https://example.com/{}", "a".repeat(120));

    assert_eq!(lines(&diagnose(&source, check)), [1]);
}

#[test]
fn a_long_string_literal_is_skipped_because_ignore_strings_defaults_to_true() {
    let source = format!("const label = \"{}\";", "a".repeat(130));

    assert_eq!(lines(&diagnose(&source, check)), [] as [usize; 0]);
}

#[test]
fn a_long_string_literal_reports_when_ignore_strings_is_false() {
    let source = format!("const label = \"{}\";", "a".repeat(130));
    let configured = options(120, 4, false, None, false, false);

    let diagnostics = diagnose_options(&source, &configured);

    assert_eq!(lines(&diagnostics), [1]);
    assert_eq!(
        diagnostics[0].message,
        "Line 1 is 147 characters long; the maximum is 120."
    );
}

#[test]
fn a_long_template_literal_reports_by_default() {
    let source = format!("const text = `{}`;", "t".repeat(130));

    let diagnostics = diagnose(&source, check);

    assert_eq!(lines(&diagnostics), [1]);
    assert_eq!(
        diagnostics[0].message,
        "Line 1 is 146 characters long; the maximum is 120."
    );
}

#[test]
fn a_long_template_literal_passes_under_ignore_template_literals() {
    let source = format!("const text = `{}`;", "t".repeat(130));
    let configured = options(120, 4, false, None, true, true);

    assert_eq!(
        lines(&diagnose_options(&source, &configured)),
        [] as [usize; 0]
    );
}

#[test]
fn tab_indentation_counts_per_tab_width() {
    let source = format!("\t// {}", "x".repeat(116));

    // tabWidth 1: the tab is one column, so the line is exactly 120 columns.
    let narrow = options(120, 1, false, None, true, false);
    assert_eq!(lines(&diagnose_options(&source, &narrow)), [] as [usize; 0]);

    // The default tabWidth 4 stretches the tab to the next tab stop: 123 columns.
    let diagnostics = diagnose(&source, check);
    assert_eq!(lines(&diagnostics), [1]);
    assert_eq!(
        diagnostics[0].message,
        "Line 1 is 123 characters long; the maximum is 120."
    );
}

#[test]
fn a_line_matching_ignore_pattern_passes() {
    let source = format!("// padding {}", "x".repeat(128));
    let configured = options(120, 4, false, Some("^// padding"), true, false);

    assert_eq!(
        lines(&diagnose_options(&source, &configured)),
        [] as [usize; 0]
    );
}

#[test]
fn the_same_line_reports_without_ignore_pattern() {
    let source = format!("// padding {}", "x".repeat(128));

    let diagnostics = diagnose(&source, check);

    assert_eq!(lines(&diagnostics), [1]);
    assert_eq!(
        diagnostics[0].message,
        "Line 1 is 139 characters long; the maximum is 120."
    );
}

#[test]
fn every_line_reports_in_order_at_its_own_number() {
    let source = format!(
        "const a = 1; {}\nconst b = 2; {}\n",
        "//".repeat(70),
        "//".repeat(70)
    );

    assert_eq!(lines(&diagnose(&source, check)), [1, 2]);
}

#[test]
fn a_comment_line_reports_even_when_it_names_quotes() {
    // The line opens with `//`, so the scanner stops before any quote and nothing exempts it.
    let source = format!("// say \"{}\" aloud", "x".repeat(120));

    assert_eq!(lines(&diagnose(&source, check)), [1]);
}
