//! The `requireParamDocs` / `requireFieldDocs` tests, split out of `tests.rs` for size.

use super::{diagnose_options, with_flag};

#[test]
fn a_function_missing_a_param_tag_for_one_parameter_is_reported() {
    let source = "/**\n * Picks a value.\n *\n * @param first - the first choice.\n */\n\
                  function pick(first: string, second: number): string {\n    return first;\n}";
    let configured = with_flag(|options| options.require_param_docs = true);

    let diagnostics = diagnose_options(source, &configured);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        ["The TSDoc on 'pick' is missing a @param tag for 'second'."]
    );
}

#[test]
fn param_tags_with_empty_descriptions_are_reported() {
    let source = "/**\n * Picks a value.\n *\n * @param first -\n * @param second\n */\n\
                  function pick(first: string, second: number): string {\n    return first;\n}";
    let configured = with_flag(|options| options.require_param_docs = true);

    let diagnostics = diagnose_options(source, &configured);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        [
            "The @param tag for 'first' on 'pick' has no description.",
            "The @param tag for 'second' on 'pick' has no description.",
        ]
    );
}

#[test]
fn a_method_missing_a_param_tag_for_one_parameter_is_reported() {
    let source = "class Counter {\n    /**\n     * Adds an amount to the count.\n     *\n     \
                  * @param amount - the amount to add.\n     */\n    \
                  add(amount: number, times: number): void {}\n}";
    let configured = with_flag(|options| options.require_param_docs = true);

    let diagnostics = diagnose_options(source, &configured);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        ["The TSDoc on 'add' is missing a @param tag for 'times'."]
    );
}

#[test]
fn a_constructor_parameter_property_among_untagged_parameters_is_reported() {
    let source = "class Box {\n    /**\n     * Builds a box.\n     *\n     \
                  * @param data - the initial contents.\n     */\n    \
                  constructor(protected data: T, scale: number) {}\n}";
    let configured = with_flag(|options| options.require_param_docs = true);

    let diagnostics = diagnose_options(source, &configured);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        ["The TSDoc on 'constructor' is missing a @param tag for 'scale'."]
    );
}

#[test]
fn a_defaulted_constructor_parameter_property_is_still_matched_to_its_tag() {
    let source = "class Box {\n    /**\n     * Builds a box.\n     *\n     \
                  * @param data - the initial contents.\n     */\n    \
                  constructor(protected data: T, protected scale: number = 1) {}\n}";
    let configured = with_flag(|options| options.require_param_docs = true);

    let diagnostics = diagnose_options(source, &configured);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        ["The TSDoc on 'constructor' is missing a @param tag for 'scale'."]
    );
}

#[test]
fn a_single_parameter_function_whose_only_tag_has_no_description_is_reported() {
    let source = "/**\n * Wraps a value.\n *\n * @param value -\n */\n\
                  function wrap(value: string): string {\n    return value;\n}";
    let configured = with_flag(|options| options.require_param_docs = true);

    let diagnostics = diagnose_options(source, &configured);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        ["The @param tag for 'value' on 'wrap' has no description."]
    );
}

#[test]
fn an_undocumented_plain_field_is_reported_under_require_field_docs() {
    let source = "class Counter {\n    count: number = 0;\n}";
    let configured = with_flag(|options| options.require_field_docs = true);

    let diagnostics = diagnose_options(source, &configured);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        ["Class property 'count' is missing its TSDoc comment."]
    );
}

#[test]
fn a_plain_field_with_an_empty_doc_is_reported_under_require_field_docs() {
    let source = "class Counter {\n    /** */\n    count: number = 0;\n}";
    let configured = with_flag(|options| options.require_field_docs = true);

    let diagnostics = diagnose_options(source, &configured);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        ["The TSDoc on 'count' has no description."]
    );
}

#[test]
fn an_exported_const_function_missing_a_param_tag_is_reported() {
    let source = "/**\n * Builds a tally.\n *\n * @param start - the starting count.\n */\n\
                  export const build = (start: number, step: number): number => start;";
    let configured = with_flag(|options| options.require_param_docs = true);

    let diagnostics = diagnose_options(source, &configured);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        ["The TSDoc on 'build' is missing a @param tag for 'step'."]
    );
}

#[test]
fn a_param_like_tag_without_a_space_is_not_a_param_tag() {
    // `@parameter` does not match `/^@param\s+/`, so it tags nothing and 'first' stays untagged.
    let source = "/**\n * Picks a value.\n *\n * @parameter first - first choice.\n \
                  * @param second - fallback.\n */\n\
                  function pick(first: string, second: number): string {\n    return first;\n}";
    let configured = with_flag(|options| options.require_param_docs = true);

    let diagnostics = diagnose_options(source, &configured);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        ["The TSDoc on 'pick' is missing a @param tag for 'first'."]
    );
}

#[test]
fn paramfirst_is_not_a_param_tag_either() {
    let source = "/**\n * Picks a value.\n *\n * @paramfirst - description.\n \
                  * @param second - fallback.\n */\n\
                  function pick(first: string, second: number): string {\n    return first;\n}";
    let configured = with_flag(|options| options.require_param_docs = true);

    let diagnostics = diagnose_options(source, &configured);

    assert_eq!(
        diagnostics
            .iter()
            .map(|diagnostic| diagnostic.message.as_str())
            .collect::<Vec<_>>(),
        ["The TSDoc on 'pick' is missing a @param tag for 'first'."]
    );
}
