#[cfg(test)]
mod params;

use super::*;
use crate::config::RequireTsdocOptions;
use crate::rules::support::testing::diagnose;
use crate::rules::support::testing::lines;
use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;
use std::path::Path;

/// Runs the rule over a snippet at explicit options, since the options live outside `check`'s
/// fixed registry signature.
fn diagnose_options(text: &str, options: &RequireTsdocOptions) -> Vec<Diagnostic> {
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

/// One or two options overridden from the JavaScript rule's defaults.
fn options(
    max_lines: u32,
    access: &str,
    require_param_docs: bool,
    require_field_docs: bool,
    allow_trivial_accessors: bool,
) -> RequireTsdocOptions {
    RequireTsdocOptions {
        max_lines,
        public_only: access == "public",
        allow_overloads: true,
        allow_inheritdoc: true,
        allow_trivial_accessors,
        require_param_docs,
        require_field_docs,
    }
}

/// The default options with one flag switched.
fn with_flag(set: fn(&mut RequireTsdocOptions)) -> RequireTsdocOptions {
    let mut options = RequireTsdocOptions::default();
    set(&mut options);
    options
}

#[test]
fn a_documented_method_passes() {
    let source = "class Counter {\n    /** Adds one to the count. */\n    increment(): void {}\n}";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn a_documented_arrow_function_class_property_passes() {
    let source = "class Counter {\n    /** Rebuilds the tally. */\n    tally = (): number => 1;\n}";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn a_documented_exported_const_function_passes() {
    let source = "/** Builds a counter. */\nexport const build = (): void => {};";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn a_documented_exported_function_declaration_passes() {
    // The doc sits above `export`, so reading the comments before the `FunctionDeclaration`
    // found none and every documented export was reported.
    let source = "/** Builds a counter. */\nexport function build(): void {}";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn a_documented_default_exported_function_passes() {
    let source = "/** Builds a counter. */\nexport default function build(): void {}";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn a_documented_method_behind_a_decorator_passes() {
    let source =
        "class Counter {\n    /** Adds one to the count. */\n    @bind\n    increment(): void {}\n}";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn a_short_summary_followed_by_a_long_rationale_passes_at_max_lines_three() {
    let source = "class Counter {\n    /**\n     * Adds one to the count.\n     *\n     \
                  * The carry wraps at midnight the way a clock does, which is the whole reason\n     \
                  * this is not a plain increment: the display reads the wrapped value, and a\n     \
                  * reader who sees 0 after 23 needs the sentence above to know it was not a bug.\n     \
                  * A fourth line of rationale, to be sure the limit is not counting these.\n     */\n    \
                  increment(): void {}\n}";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn an_overload_signature_without_a_doc_is_exempt_by_default() {
    let source = "function pick(first: string): string;\n\
                  function pick(first: string, second: number): string;\n\
                  /** Picks the first value. */\n\
                  function pick(first: string, second?: number): string {\n    return first;\n}";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn a_pure_inheritdoc_doc_on_a_method_is_exempt_by_default() {
    let source = "class Counter {\n    /** @inheritdoc */\n    render(): void {}\n}";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn a_getter_and_setter_without_docs_pass_under_allow_trivial_accessors() {
    let source =
        "class Amount {\n    get value(): number { return 1; }\n    set value(next: number) {}\n}";
    let configured = options(3, "all", false, false, true);

    assert_eq!(
        lines(&diagnose_options(source, &configured)),
        [] as [usize; 0]
    );
}

#[test]
fn a_private_method_without_a_doc_passes_under_access_public() {
    let source = "class Amount {\n    private log(): void {}\n}";
    let configured = options(3, "public", false, false, false);

    assert_eq!(
        lines(&diagnose_options(source, &configured)),
        [] as [usize; 0]
    );
}

#[test]
fn a_function_with_every_parameter_tagged_passes_under_require_param_docs() {
    let source = "/**\n * Picks a value.\n *\n * @param first - the first choice.\n \
                  * @param second - the fallback when the first is missing.\n */\n\
                  function pick(first: string, second: number): string {\n    return first;\n}";
    let configured = with_flag(|options| options.require_param_docs = true);

    assert_eq!(
        lines(&diagnose_options(source, &configured)),
        [] as [usize; 0]
    );
}

#[test]
fn a_single_parameter_function_without_a_tag_is_exempt() {
    let source =
        "/** Wraps a value. */\nfunction wrap(value: string): string {\n    return value;\n}";
    let configured = with_flag(|options| options.require_param_docs = true);

    assert_eq!(
        lines(&diagnose_options(source, &configured)),
        [] as [usize; 0]
    );
}

#[test]
fn a_constructor_parameter_property_is_documented_by_its_own_param_tag() {
    let source = "class Box {\n    /**\n     * Builds a box.\n     *\n     \
                  * @param data - the initial contents.\n     * @param scale - the drawing scale.\n     */\n    \
                  constructor(protected data: T, scale: number) {}\n}";
    let configured = with_flag(|options| {
        options.require_param_docs = true;
        options.require_field_docs = true;
    });

    assert_eq!(
        lines(&diagnose_options(source, &configured)),
        [] as [usize; 0]
    );
}

#[test]
fn a_defaulted_constructor_parameter_property_is_tagged_by_its_own_name() {
    let source = "class Box {\n    /**\n     * Builds a box.\n     *\n     \
                  * @param data - the initial contents.\n     * @param scale - the drawing scale.\n     */\n    \
                  constructor(protected data: T, protected scale: number = 1) {}\n}";
    let configured = with_flag(|options| {
        options.require_param_docs = true;
        options.require_field_docs = true;
    });

    assert_eq!(
        lines(&diagnose_options(source, &configured)),
        [] as [usize; 0]
    );
}

#[test]
fn a_plain_documented_field_passes_under_require_field_docs() {
    let source = "class Counter {\n    /** The current count. */\n    count: number = 0;\n}";
    let configured = with_flag(|options| options.require_field_docs = true);

    assert_eq!(
        lines(&diagnose_options(source, &configured)),
        [] as [usize; 0]
    );
}

#[test]
fn an_undocumented_plain_field_with_the_new_options_off_passes() {
    let source = "class Counter {\n    count: number = 0;\n}";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn an_overload_signature_passes_with_the_new_checks_on() {
    let source = "function pick(first: string): string;\n\
                  function pick(first: string, second: number): string;\n\
                  /**\n * Picks the first value.\n *\n * @param first - the first choice.\n \
                  * @param second - the fallback when the first is missing.\n */\n\
                  function pick(first: string, second?: number): string {\n    return first;\n}";
    let configured = with_flag(|options| {
        options.require_param_docs = true;
        options.require_field_docs = true;
    });

    assert_eq!(
        lines(&diagnose_options(source, &configured)),
        [] as [usize; 0]
    );
}

#[test]
fn a_pure_inheritdoc_method_with_untagged_parameters_passes() {
    let source = "class Counter {\n    /** @inheritdoc */\n    render(value: number): void {}\n}";
    let configured = with_flag(|options| {
        options.require_param_docs = true;
        options.require_field_docs = true;
    });

    assert_eq!(
        lines(&diagnose_options(source, &configured)),
        [] as [usize; 0]
    );
}

#[test]
fn a_private_method_with_untagged_parameters_passes_under_access_public() {
    let source = "class Amount {\n    private log(message: string): void {}\n}";
    let configured = options(3, "public", true, true, false);

    assert_eq!(
        lines(&diagnose_options(source, &configured)),
        [] as [usize; 0]
    );
}

#[test]
fn a_getter_and_setter_with_the_new_checks_on_pass_under_allow_trivial_accessors() {
    let source =
        "class Amount {\n    get value(): number { return 1; }\n    set value(next: number) {}\n}";
    let configured = options(3, "all", true, true, true);

    assert_eq!(
        lines(&diagnose_options(source, &configured)),
        [] as [usize; 0]
    );
}

#[test]
fn a_private_plain_field_passes_under_access_public_and_require_field_docs() {
    let source = "class Amount {\n    private secret: string = '';\n}";
    let configured = options(3, "public", false, true, false);

    assert_eq!(
        lines(&diagnose_options(source, &configured)),
        [] as [usize; 0]
    );
}

#[test]
fn an_undocumented_method_is_reported() {
    let source = "class Counter {\n    increment(): void {}\n}";

    let diagnostics = diagnose(source, check);

    assert_eq!(lines(&diagnostics), [2]);
    assert_eq!(
        diagnostics[0].message,
        "Method 'increment' is missing its TSDoc comment."
    );
}

#[test]
fn an_undocumented_arrow_function_class_property_is_reported() {
    let source = "class Counter {\n    tally = (): number => 1;\n}";

    let diagnostics = diagnose(source, check);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        ["Class property 'tally' is missing its TSDoc comment."]
    );
}

#[test]
fn an_undocumented_exported_const_function_is_reported() {
    let source = "export const build = (): void => {};";

    let diagnostics = diagnose(source, check);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        ["Exported function 'build' is missing its TSDoc comment."]
    );
}

#[test]
fn an_undocumented_exported_function_reports_on_the_function_below_the_export() {
    // The comment would be read before `export`, but the report sits on the declaration itself:
    // `function` starts at column 8 after `export `.
    let source = "export function build(): void {};";

    let diagnostics = diagnose(source, check);

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].line, 1);
    assert_eq!(diagnostics[0].column, 8);
}

#[test]
fn an_undocumented_default_export_reports_on_the_function_after_default() {
    // `function` starts at column 16 after `export default `.
    let source = "export default function build(): void {};";

    let diagnostics = diagnose(source, check);

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].line, 1);
    assert_eq!(diagnostics[0].column, 16);
}

#[test]
fn an_undocumented_function_reports_at_the_function_keyword() {
    let source = "function pick(first: string): string { return first; }";

    let diagnostics = diagnose(source, check);

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].line, 1);
    assert_eq!(diagnostics[0].column, 1);
}

#[test]
fn an_undocumented_exported_const_reports_on_the_declarator() {
    // `build` starts at column 14 after `export const `.
    let source = "export const build = (): void => {};";

    let diagnostics = diagnose(source, check);

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].line, 1);
    assert_eq!(diagnostics[0].column, 14);
}

#[test]
fn an_undocumented_function_declaration_is_reported() {
    let source = "function pick(first: string): string { return first; }";

    let diagnostics = diagnose(source, check);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        ["Function 'pick' is missing its TSDoc comment."]
    );
}

#[test]
fn a_line_comment_where_a_block_is_required_is_reported() {
    let source = "class Counter {\n    // Adds one to the count.\n    increment(): void {}\n}";

    let diagnostics = diagnose(source, check);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        ["Method 'increment' has a // comment where a /** */ TSDoc block is required."]
    );
}

#[test]
fn a_plain_block_where_tsdoc_is_required_is_reported() {
    let source = "class Counter {\n    /* Adds one to the count. */\n    increment(): void {}\n}";

    let diagnostics = diagnose(source, check);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        ["Method 'increment' is documented with a plain /* */ block; TSDoc requires /** */."]
    );
}

#[test]
fn a_pure_inheritdoc_doc_reports_when_allow_inheritdoc_is_false() {
    let source = "class Counter {\n    /** @inheritdoc */\n    render(): void {}\n}";
    let configured = with_flag(|options| options.allow_inheritdoc = false);

    let diagnostics = diagnose_options(source, &configured);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        ["The TSDoc on 'render' has no description."]
    );
}

#[test]
fn an_overload_signature_reports_when_allow_overloads_is_false() {
    let source = "function pick(first: string): string;";
    let configured = with_flag(|options| options.allow_overloads = false);

    let diagnostics = diagnose_options(source, &configured);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        ["Function 'pick' is missing its TSDoc comment."]
    );
}

#[test]
fn a_doc_with_an_empty_description_is_reported() {
    let source = "class Counter {\n    /** */\n    increment(): void {}\n}";

    let diagnostics = diagnose(source, check);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        ["The TSDoc on 'increment' has no description."]
    );
}

#[test]
fn a_documented_outer_function_excuses_only_itself_of_the_pair() {
    // The inner declaration is reached through the walk of the outer body, so it is checked
    // too; the outer doc says nothing about the inner one.
    let source = "/** Creates a helper. */\n\
                  function outer() {\n    function inner() {}\n}";

    let diagnostics = diagnose(source, check);

    assert_eq!(lines(&diagnostics), [3]);
    assert_eq!(
        diagnostics[0].message,
        "Function 'inner' is missing its TSDoc comment."
    );
}

#[test]
fn a_documented_inner_function_inside_a_documented_outer_passes() {
    let source = "/** Creates a helper. */\n\
                  function outer() {\n    /** Does work. */\n\n    function inner() {}\n}";

    assert_eq!(lines(&diagnose(source, check)), [] as [usize; 0]);
}

#[test]
fn a_nested_function_inside_an_if_block_is_reported() {
    let source = "function outer() {\n    if (true) {\n        function inner() {}\n    }\n}";

    let diagnostics = diagnose(source, check);

    // The outer declaration is undocumented too, so it is reported alongside the inner one.
    assert_eq!(lines(&diagnostics), [1, 3]);
    assert_eq!(
        diagnostics[1].message,
        "Function 'inner' is missing its TSDoc comment."
    );
}

#[test]
fn a_method_of_a_class_expression_in_a_constant_is_reported() {
    let source = "const Counter = class {\n    increment(): void {}\n};";

    let diagnostics = diagnose(source, check);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        ["Method 'increment' is missing its TSDoc comment."]
    );
}

#[test]
fn a_function_declaration_inside_an_arrow_body_is_reported() {
    let source = "const run = (): void => {\n    function inner() {}\n};";

    let diagnostics = diagnose(source, check);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        ["Function 'inner' is missing its TSDoc comment."]
    );
}

#[test]
fn a_class_declared_inside_a_function_body_has_its_method_checked() {
    let source = "/** Wraps the check. */\n\
                  function outer() {\n    class Inner {\n        run(): void {}\n    }\n}";

    let diagnostics = diagnose(source, check);

    assert_eq!(lines(&diagnostics), [4]);
    assert_eq!(
        diagnostics[0].message,
        "Method 'run' is missing its TSDoc comment."
    );
}

#[test]
fn a_five_line_summary_reports_under_max_lines_three() {
    let source = "class Counter {\n    /**\n     * Adds one to the count and, when the carry overflows,\n     \
                  * wraps the counter around,\n     * resetting it to zero,\n     * as clocks do at midnight,\n     \
                  * every day.\n     */\n    increment(): void {}\n}";
    let configured = with_flag(|options| options.max_lines = 3);

    let diagnostics = diagnose_options(source, &configured);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        [
            "The TSDoc summary on 'increment' is 5 lines; the maximum is 3. Keep the summary \
             short and put the rest after a blank line."
        ]
    );
}
