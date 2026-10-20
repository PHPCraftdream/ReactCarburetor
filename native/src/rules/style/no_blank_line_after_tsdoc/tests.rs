use super::*;
use crate::fix;
use crate::rules::support::testing::{diagnose, lines};

/// The source after applying whatever fixes the rule suggested, when all of them apply.
fn fixed(text: &str) -> String {
    let diagnostics = diagnose(text, check);
    let fixes = diagnostics
        .iter()
        .filter_map(|diagnostic| diagnostic.fix.as_ref());

    fix::apply(text, fixes.collect()).expect("every case here expects its fixes to apply")
}

#[test]
fn a_doc_directly_above_a_function_passes() {
    let source = "/** Adds two amounts. */\n\
                  function add(a: number, b: number): number {\n    return a + b;\n}";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn a_doc_directly_above_an_indented_class_method_passes() {
    let source = "class Counter {\n    /** Adds one to the count. */\n    increment(): void {}\n}";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn one_blank_line_between_a_doc_and_a_function_is_reported_and_fixed() {
    let source = "/** Adds two amounts. */\n\n\
                  function add(a: number, b: number): number {\n    return a + b;\n}";
    let expected = "/** Adds two amounts. */\n\
                    function add(a: number, b: number): number {\n    return a + b;\n}";

    let diagnostics = diagnose(source, check);

    assert_eq!(lines(&diagnostics), [1]);
    assert_eq!(
        diagnostics[0].message,
        "A blank line separates the TSDoc comment from 'add'."
    );
    assert_eq!(fixed(source), expected);
}

#[test]
fn a_blank_line_before_an_indented_method_is_fixed_keeping_its_indent() {
    let source =
        "class Counter {\n    /** Adds one to the count. */\n\n    increment(): void {}\n}";
    let expected =
        "class Counter {\n    /** Adds one to the count. */\n    increment(): void {}\n}";

    let diagnostics = diagnose(source, check);

    assert_eq!(lines(&diagnostics), [2]);
    assert_eq!(
        diagnostics[0].message,
        "A blank line separates the TSDoc comment from 'increment'."
    );
    assert_eq!(fixed(source), expected);
}

#[test]
fn a_blank_line_before_an_exported_function_declaration_is_reported() {
    // The doc of an exported declaration sits above `export`, so reading the comments before the
    // declaration itself found none and the gap went unreported.
    let source = "/** Adds two amounts. */\n\n\
                  export function add(a: number, b: number): number {\n    return a + b;\n}";
    let expected = "/** Adds two amounts. */\n\
                    export function add(a: number, b: number): number {\n    return a + b;\n}";

    let diagnostics = diagnose(source, check);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        ["A blank line separates the TSDoc comment from 'add'."]
    );
    assert_eq!(fixed(source), expected);
}

#[test]
fn a_blank_line_before_an_exported_class_is_reported_and_fixed() {
    let source = "/** Counts things. */\n\nexport class Counter {}";
    let expected = "/** Counts things. */\nexport class Counter {}";

    let diagnostics = diagnose(source, check);

    assert_eq!(lines(&diagnostics), [1]);
    assert_eq!(
        diagnostics[0].message,
        "A blank line separates the TSDoc comment from 'Counter'."
    );
    assert_eq!(fixed(source), expected);
}

#[test]
fn two_blank_lines_collapse_into_none() {
    let source = "/** Adds two amounts. */\n\n\n\
                  function add(a: number, b: number): number {\n    return a + b;\n}";
    let expected = "/** Adds two amounts. */\n\
                    function add(a: number, b: number): number {\n    return a + b;\n}";

    let diagnostics = diagnose(source, check);

    assert_eq!(lines(&diagnostics), [1]);
    assert_eq!(fixed(source), expected);
}

#[test]
fn a_blank_line_before_an_arrow_function_class_property_is_reported() {
    let source =
        "class Counter {\n    /** Rebuilds the tally. */\n\n    tally = (): number => 1;\n}";
    let expected =
        "class Counter {\n    /** Rebuilds the tally. */\n    tally = (): number => 1;\n}";

    let diagnostics = diagnose(source, check);

    assert_eq!(lines(&diagnostics), [2]);
    assert_eq!(
        diagnostics[0].message,
        "A blank line separates the TSDoc comment from 'tally'."
    );
    assert_eq!(fixed(source), expected);
}

#[test]
fn a_blank_line_before_an_exported_const_function_is_reported() {
    let source = "/** Builds a counter. */\n\nexport const build = (): void => {};";
    let expected = "/** Builds a counter. */\nexport const build = (): void => {};";

    let diagnostics = diagnose(source, check);

    assert_eq!(lines(&diagnostics), [1]);
    assert_eq!(
        diagnostics[0].message,
        "A blank line separates the TSDoc comment from 'build'."
    );
    assert_eq!(fixed(source), expected);
}

#[test]
fn a_gap_without_a_blank_line_between_code_stays_silent() {
    let source = "class Counter {\n    /** Adds one. */\n    other(): void {}\n\n    increment(): void {}\n}";

    // The comment is not adjacent to `increment` — `other` sits between them — so nothing is
    // read as the method's documentation, let alone a split-off one.
    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn a_non_tsdoc_comment_split_by_a_blank_line_stays_silent() {
    let source = "// Adds two amounts.\n\nfunction add(a: number, b: number): number {}";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn a_class_property_that_is_not_a_function_stays_silent() {
    let source = "class Counter {\n    /** The count. */\n\n    count: number = 0;\n}";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}
