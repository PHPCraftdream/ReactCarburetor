use super::RULE;
use crate::rules::classes::testing::{beside_reference, css, lines, REFERENCE};

#[test]
fn the_reference_stylesheet_is_clean() {
    assert!(css(
        &[("styles/reference.css", REFERENCE)],
        "styles/reference.css",
        RULE
    )
    .is_empty());
}

#[test]
fn names_need_two_words_and_no_reserved_first_word() {
    let findings = beside_reference(
        "@layer components {\n  .button { @apply pattern-button tone-accent-solid; }\n  .shape-button { @apply pattern-button tone-accent-solid; }\n  .Save-button { @apply pattern-button tone-accent-solid; }\n  .save-button { @apply pattern-button tone-accent-solid; }\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [2, 3, 4]);
    assert!(findings[0].2.contains("at least two words"), "{findings:?}");
    assert!(
        findings[1]
            .2
            .contains("starts with shape, which names a floor"),
        "{findings:?}"
    );
    assert!(findings[2].2.contains("lowercase words"), "{findings:?}");
}

#[test]
fn a_function_needs_exactly_one_tone_and_at_most_one_pattern() {
    let findings = beside_reference(
        "@layer components {\n  .bare-button { @apply pattern-button; }\n  .loud-button { @apply pattern-button tone-accent-solid tone-accent-outline; }\n  .twin-button { @apply pattern-button pattern-card tone-accent-solid; }\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [2, 3, 4]);
    assert!(findings[0].2.contains("has no Tone"), "{findings:?}");
    assert!(findings[1].2.contains("applies 2 Tones"), "{findings:?}");
    assert!(findings[2].2.contains("applies 2 Patterns"), "{findings:?}");
}

#[test]
fn bricks_declarations_variants_and_functions_are_reported() {
    let findings = beside_reference(
        "@layer components {\n  .wide-button {\n    @apply pattern-button tone-accent-solid px-8 hover:shape-control submit-button dark:tone-accent-outline;\n    color: red;\n  }\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [3, 3, 3, 3, 4]);
    let messages: Vec<&str> = findings
        .iter()
        .map(|(_, _, message)| message.as_str())
        .collect();
    assert!(messages[0].contains("px-8 is a Brick"), "{messages:?}");
    assert!(
        messages[1].contains("variants belong inside Tones and Traits"),
        "{messages:?}"
    );
    assert!(
        messages[2].contains("submit-button is a Function"),
        "{messages:?}"
    );
    assert!(messages[3].contains("dark:"), "{messages:?}");
    assert!(
        messages[4].contains("holds no declarations; put color in a Trait"),
        "{messages:?}"
    );
}

#[test]
fn selectors_and_layer_contents_are_checked() {
    let findings = beside_reference(
        "@layer components {\n  .a-b .c-d { @apply tone-accent-solid; }\n  .menu-list:hover { @apply tone-accent-solid; }\n  --x: 1;\n  @media (width > 1px) { .x-y { @apply tone-accent-solid; } }\n  .menu-item {\n    @apply pattern-card tone-accent-solid;\n    & .label { @apply tone-accent-outline; }\n  }\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [2, 3, 4, 5, 8]);
    assert!(
        findings[0].2.contains("a Function selector is one class"),
        "{findings:?}"
    );
    assert!(
        findings[2].2.contains("holds only Function rules"),
        "{findings:?}"
    );
    assert!(
        findings[4].2.contains("nests only state blocks"),
        "{findings:?}"
    );
}

#[test]
fn state_blocks_only_swap_the_tone() {
    let findings = beside_reference(
        "@layer components {\n  .save-button { @apply pattern-button tone-accent-solid; }\n  .save-button[data-busy] { @apply tone-accent-outline shape-control; }\n  .save-button[aria-disabled=\"true\"] { color: gray; }\n  .lost-button[data-x] { @apply tone-accent-solid; }\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [3, 3, 4, 4, 5]);
    assert!(
        findings[4].2.contains("no Function rule defines"),
        "{findings:?}"
    );
}

#[test]
fn utilities_on_no_floor_and_classes_outside_the_layer_are_reported() {
    let findings = beside_reference(
        "@utility save-button { @apply px-4; }\n.loose-class { color: red; }\nbody { color: black; }\n",
        RULE,
    );

    assert_eq!(lines(&findings), [1, 2]);
    assert!(findings[0].2.contains("is on no floor"), "{findings:?}");
    assert!(
        findings[1].2.contains("outside @layer components"),
        "{findings:?}"
    );
}
