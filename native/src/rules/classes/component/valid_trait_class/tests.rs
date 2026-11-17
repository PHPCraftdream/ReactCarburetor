use super::RULE;
use crate::rules::classes::testing::{beside_reference, css, css_with, lines, REFERENCE};

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
fn colour_in_a_trait_is_reported_as_brick_and_as_declaration() {
    let findings = beside_reference(
        "@utility shape-tile {\n  @apply p-2 bg-accent-fill;\n  border-color: black;\n  width: var(--color-accent-fill);\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [2, 3, 4]);
    assert!(findings
        .iter()
        .all(|(_, _, message)| message.contains("colour belongs to Tones")));
}

#[test]
fn a_property_another_kind_owns_is_reported() {
    let findings = beside_reference(
        "@utility shape-tile {\n  @apply p-2 text-sm flex;\n  font-weight: 600;\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [2, 2, 3]);
    assert!(
        findings[0]
            .2
            .contains("which the type kind owns, not shape"),
        "{findings:?}"
    );
    assert!(
        findings[1].2.contains("which the layout kind owns"),
        "{findings:?}"
    );
    assert!(findings[2].2.contains("font-weight"), "{findings:?}");
}

#[test]
fn a_brick_spanning_several_kinds_is_reported() {
    let findings = beside_reference("@utility type-cut {\n  @apply truncate;\n}\n", RULE);

    assert_eq!(lines(&findings), [2]);
    assert!(
        findings[0].2.contains("several kinds (layout and type)"),
        "{findings:?}"
    );
}

#[test]
fn a_property_no_kind_owns_is_reported() {
    let findings = beside_reference(
        "@utility shape-masked {\n  @apply [mask-type:luminance];\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [2]);
    assert!(
        findings[0].2.contains("no trait kind owns mask-type"),
        "{findings:?}"
    );
}

#[test]
fn other_floors_nested_rules_and_dark_are_reported() {
    let findings = beside_reference(
        "@utility layout-stack {\n  @apply flex tone-accent-solid layout-row dark:flex-col;\n  &:hover { display: block; }\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [2, 2, 2, 3]);
    let messages: Vec<&str> = findings
        .iter()
        .map(|(_, _, message)| message.as_str())
        .collect();
    assert!(
        messages[0].contains("tone-accent-solid is a Tone"),
        "{messages:?}"
    );
    assert!(
        messages[1].contains("layout-row is a Trait"),
        "{messages:?}"
    );
    assert!(messages[2].contains("dark:"), "{messages:?}");
    assert!(
        messages[3].contains("only @apply of Bricks"),
        "{messages:?}"
    );
}

#[test]
fn configured_kinds_decide_ownership() {
    let config = r#"{"classes": {"css": ["**/*.css"], "traitKinds": {"box": ["padding*", "mask-*"], "ink": ["font-*"]}}}"#;
    let text = "@utility box-masked {\n  @apply p-2 [mask-type:luminance] font-bold;\n}\n";
    let findings = css_with(config, &[("styles/a.css", text)], "styles/a.css", RULE);

    assert_eq!(lines(&findings), [2]);
    assert!(
        findings[0].2.contains("which the ink kind owns, not box"),
        "{findings:?}"
    );
}
