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
fn bricks_tones_and_other_patterns_are_reported() {
    let findings = beside_reference(
        "@utility pattern-chip {\n  @apply shape-control px-2 tone-accent-solid pattern-button;\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [2, 2, 2]);
    let messages: Vec<&str> = findings
        .iter()
        .map(|(_, _, message)| message.as_str())
        .collect();
    assert!(messages[0].contains("px-2 is a Brick"), "{messages:?}");
    assert!(
        messages[1].contains("colour comes from the Function's Tone"),
        "{messages:?}"
    );
    assert!(
        messages[2].contains("pattern-button is a Pattern"),
        "{messages:?}"
    );
}

#[test]
fn declarations_nested_rules_and_dark_are_reported() {
    let findings = beside_reference(
        "@utility pattern-chip {\n  display: flex;\n  &:hover { @apply shape-control; }\n  @apply dark:shape-control;\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [2, 3, 4]);
    assert!(
        findings[0].2.contains("only @apply of Traits"),
        "{findings:?}"
    );
    assert!(findings[2].2.contains("dark:"), "{findings:?}");
}

#[test]
fn a_badly_spelled_name_is_reported() {
    let findings = beside_reference(
        "@utility pattern-Chip {\n  @apply shape-control;\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [1]);
}
