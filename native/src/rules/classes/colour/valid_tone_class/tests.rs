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
fn a_name_outside_the_grammar_is_reported() {
    let findings = beside_reference(
        "@utility tone-brand-solid { @apply bg-accent-fill; }\n@utility tone-accent-glossy { @apply bg-accent-fill; }\n@utility tone-surface-floating { @apply bg-surface-raised; }\n",
        RULE,
    );

    assert_eq!(lines(&findings), [1, 2, 3]);
    assert!(
        findings[0].2.contains("deliveries: solid, soft"),
        "{findings:?}"
    );
}

#[test]
fn anything_but_apply_is_reported() {
    let findings = beside_reference(
        "@utility tone-accent-soft {\n  color: red;\n  &:hover { @apply bg-accent-fill; }\n  @apply text-accent-ink;\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [2, 3]);
    assert!(findings
        .iter()
        .all(|(_, _, message)| message.contains("only @apply of colour Bricks")));
}

#[test]
fn non_colour_bricks_other_floors_and_raw_colours_are_reported() {
    let findings = beside_reference(
        "@utility tone-accent-soft {\n  @apply px-4 shape-control bg-[#fff] text-accent-ink bg-blue-600;\n}\n",
        RULE,
    );

    // bg-blue-600 names no Role: that is no-unknown-class-reference's finding, not this rule's.
    assert_eq!(lines(&findings), [2, 2, 2]);
    let messages: Vec<&str> = findings
        .iter()
        .map(|(_, _, message)| message.as_str())
        .collect();
    assert!(messages[0].contains("px-4 is not a colour"), "{messages:?}");
    assert!(
        messages[1].contains("shape-control is a Trait"),
        "{messages:?}"
    );
    assert!(messages[2].contains("raw colour"), "{messages:?}");
}

#[test]
fn another_family_or_a_slot_outside_the_delivery_is_reported() {
    let findings = beside_reference(
        "@theme {\n  --color-danger-fill: var(--palette-blue-600);\n}\n@utility tone-accent-soft {\n  @apply bg-danger-fill text-accent-ink bg-accent-fill;\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [5, 5]);
    assert!(findings[0].2.contains("danger family"), "{findings:?}");
    assert!(
        findings[1].2.contains("soft delivery does not use"),
        "{findings:?}"
    );
}

#[test]
fn a_state_role_needs_its_variant_and_the_focus_ring_is_allowed() {
    let findings = beside_reference(
        "@utility tone-accent-plain {\n  @apply text-accent-ink bg-accent-fill-hover focus-visible:outline-accent-edge;\n}\n",
        RULE,
    );

    // bg-accent-fill-hover without hover: is reported for the state before the slot.
    assert_eq!(lines(&findings), [2]);
    assert!(
        findings[0].2.contains("apply it under hover:"),
        "{findings:?}"
    );
}

#[test]
fn surface_tones_paint_their_level_and_neutral_ink() {
    let findings = beside_reference(
        "@theme {\n  --color-surface-page: var(--palette-white);\n}\n@utility tone-surface-page {\n  @apply bg-surface-page text-neutral-ink bg-surface-raised text-accent-ink;\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [5, 5]);
    assert!(
        findings[0].2.contains("paints surface-raised"),
        "{findings:?}"
    );
    assert!(findings[1].2.contains("only neutral ink"), "{findings:?}");
}

#[test]
fn dark_is_reported() {
    let findings = beside_reference(
        "@utility tone-accent-plain {\n  @apply text-accent-ink dark:text-accent-ink;\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [2]);
    assert!(
        findings[0].2.contains("dark: variant is not allowed"),
        "{findings:?}"
    );
}
