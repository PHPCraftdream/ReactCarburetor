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
fn one_blank_line_between_the_description_and_the_params_passes() {
    let source = "/**\n * Adds two amounts.\n *\n * @param a - the first amount\n \
                  * @param b - the second amount\n */\n\
                  function add(a: number, b: number): number {\n    return a + b;\n}";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn a_single_line_doc_passes() {
    let source =
        "/** Adds two amounts. */\nfunction add(a: number, b: number): number {\n    return a + b;\n}";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn tags_only_with_no_description_pass() {
    let source =
        "/**\n * @param a - the amount\n */\nfunction twice(a: number): number {\n    return a * 2;\n}";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn a_description_without_tags_passes() {
    let source = "/**\n * Adds one.\n *\n * Nothing else to say.\n */\n\
                  function inc(a: number): number {\n    return a + 1;\n}";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn a_line_starting_with_an_at_inside_a_code_fence_is_not_a_tag() {
    let source = "/**\n * Binds once:\n * ```ts\n * @bind\n * handle() {}\n * ```\n */\n\
                  function example(): void {}";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn a_plain_block_comment_is_not_tsdoc() {
    let source = "/*\n * Not a doc.\n * @param nothing\n */\nfunction plain(): void {}";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn no_blank_line_before_the_params_is_reported_and_fixed() {
    let source = "/**\n * Adds two amounts.\n * @param a - the first amount\n */\n\
                  function add(a: number): number {\n    return a;\n}";
    let expected = "/**\n * Adds two amounts.\n *\n * @param a - the first amount\n */\n\
                    function add(a: number): number {\n    return a;\n}";

    let diagnostics = diagnose(source, check);

    assert_eq!(lines(&diagnostics), [1]);
    assert_eq!(
        diagnostics[0].message,
        "Add one blank line between the TSDoc description and its first tag."
    );
    assert_eq!(fixed(source), expected);
}

#[test]
fn two_blank_lines_collapse_to_one() {
    let source = "/**\n * Adds two amounts.\n *\n *\n * @param a - the first amount\n */\n\
                  function add(a: number): number {\n    return a;\n}";
    let expected = "/**\n * Adds two amounts.\n *\n * @param a - the first amount\n */\n\
                    function add(a: number): number {\n    return a;\n}";

    let diagnostics = diagnose(source, check);

    assert_eq!(lines(&diagnostics), [1]);
    assert_eq!(
        diagnostics[0].message,
        "Keep exactly one blank line between the TSDoc description and its first tag, not 2."
    );
    assert_eq!(fixed(source), expected);
}

#[test]
fn a_description_on_the_opening_line_is_fixed_in_the_class_indent() {
    let source = "class Counter {\n    /** Adds to the count.\n     * @param by - how much\n     */\n    \
                  add(by: number): void {}\n}";
    let expected = "class Counter {\n    /** Adds to the count.\n     *\n     * @param by - how much\n     */\n    \
                    add(by: number): void {}\n}";

    let diagnostics = diagnose(source, check);

    assert_eq!(lines(&diagnostics), [2]);
    assert_eq!(fixed(source), expected);
}

#[test]
fn the_first_tag_decides_whatever_it_is() {
    let source = "/**\n * Reads it.\n * @returns the value\n */\nfunction read(): number {\n    return 1;\n}";
    let expected = "/**\n * Reads it.\n *\n * @returns the value\n */\nfunction read(): number {\n    return 1;\n}";

    let diagnostics = diagnose(source, check);

    assert_eq!(lines(&diagnostics), [1]);
    assert_eq!(
        diagnostics[0].message,
        "Add one blank line between the TSDoc description and its first tag."
    );
    assert_eq!(fixed(source), expected);
}
