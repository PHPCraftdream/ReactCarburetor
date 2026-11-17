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
fn typos_and_classes_nobody_defines_are_reported_at_any_depth() {
    let findings = beside_reference(
        "@utility shape-tile { @apply p-2 shape-contrl; }\n@layer base {\n  body { @apply font-sans nonsense; }\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [1, 3]);
    assert!(
        findings[0].2.contains("shape-contrl is neither"),
        "{findings:?}"
    );
    assert_eq!(findings[0].1, 34);
}

#[test]
fn stock_colours_name_no_role() {
    let findings = beside_reference(
        "@utility tone-accent-plain { @apply text-accent-ink hover:text-blue-600; }\n",
        RULE,
    );

    assert_eq!(lines(&findings), [1]);
    assert!(
        findings[0]
            .2
            .contains("hover:text-blue-600 names no Role (blue-600)"),
        "{findings:?}"
    );
}

#[test]
fn classes_defined_in_other_files_resolve() {
    let findings = beside_reference(
        "@layer components {\n  .wide-button { @apply pattern-button shape-control tone-accent-solid; }\n}\n",
        RULE,
    );

    assert!(findings.is_empty(), "{findings:?}");
}
