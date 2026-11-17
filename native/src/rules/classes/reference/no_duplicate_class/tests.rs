use super::RULE;
use crate::rules::classes::testing::{css, lines, REFERENCE};

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
fn a_second_definition_is_reported_where_it_is_with_the_first_location() {
    let later = "@utility shape-control { @apply h-8; }\n:root { --palette-white: #fefefe; }\n@theme { --color-accent-fill: var(--palette-white); }\n@layer components {\n  .submit-button { @apply pattern-button tone-accent-solid; }\n}\n";
    let files = [
        ("styles/a-reference.css", REFERENCE),
        ("styles/b-later.css", later),
    ];

    let findings = css(&files, "styles/b-later.css", RULE);
    assert_eq!(lines(&findings), [1, 2, 3, 5]);
    assert!(
        findings[0]
            .2
            .contains("shape-control is already defined at styles/a-reference.css:"),
        "{findings:?}"
    );
    assert!(
        findings[1].2.contains("--palette-white is already defined"),
        "{findings:?}"
    );
    assert!(
        findings[2]
            .2
            .contains("--color-accent-fill is already defined"),
        "{findings:?}"
    );

    // The first definition is never the one reported.
    assert!(css(&files, "styles/a-reference.css", RULE).is_empty());
}

#[test]
fn overrides_and_state_blocks_are_not_definitions() {
    let later = "[data-theme=\"dark\"] { --color-accent-fill: var(--palette-blue-700); }\n@layer components {\n  .submit-button[data-busy] { @apply tone-accent-outline; }\n}\n";
    let files = [
        ("styles/a-reference.css", REFERENCE),
        ("styles/b-later.css", later),
    ];

    assert!(css(&files, "styles/b-later.css", RULE).is_empty());
}

#[test]
fn a_duplicate_in_the_same_file_is_reported_at_the_second() {
    let text = "@utility shape-a { @apply p-1; }\n@utility shape-a { @apply p-2; }\n";

    let findings = css(&[("styles/a.css", text)], "styles/a.css", RULE);
    assert_eq!(lines(&findings), [2]);
    assert!(findings[0].2.contains("styles/a.css:1"), "{findings:?}");
}
