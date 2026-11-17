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
fn a_theme_without_the_reset_is_reported_once_per_block() {
    let text = ":root { --palette-blue-600: #2563eb; }\n@theme {\n  --color-accent-fill: var(--palette-blue-600);\n}\n";
    let findings = css(&[("styles/app.css", text)], "styles/app.css", RULE);

    assert_eq!(lines(&findings), [2]);
    assert!(findings[0].2.contains("--color-*: initial"), "{findings:?}");
}

#[test]
fn the_reset_in_another_file_counts() {
    let findings = beside_reference(
        "@theme {\n  --color-danger-fill: var(--palette-blue-600);\n}\n",
        RULE,
    );

    assert!(findings.is_empty(), "{findings:?}");
}

#[test]
fn names_outside_the_grammar_or_the_lists_are_reported() {
    let findings = beside_reference(
        "@theme {\n  --color-brand: var(--palette-blue-600);\n  --color-accent-glow: var(--palette-blue-600);\n  --color-accent-fill-focus: var(--palette-blue-600);\n  --color-surface-floating: var(--palette-blue-600);\n  --color-accent-ink-subtle-hover: var(--palette-blue-600);\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [2, 3, 4, 5]);
    assert!(
        findings[0].2.contains("families: neutral, accent"),
        "{findings:?}"
    );
}

#[test]
fn a_value_other_than_one_palette_reference_is_reported() {
    let findings = beside_reference(
        "@theme {\n  --color-danger-fill: #ef4444;\n  --color-danger-ink: var(--color-accent-fill);\n  --color-danger-edge: color-mix(in oklch, var(--palette-blue-600), white);\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [2, 3, 4]);
    assert!(findings
        .iter()
        .all(|(_, _, message)| message.contains("a Role's value is var(--palette-…)")));
}

#[test]
fn an_override_of_an_undefined_role_or_with_a_raw_value_is_reported() {
    let findings = beside_reference(
        "[data-theme=\"dark\"] {\n  --color-accent-glow: var(--palette-blue-600);\n  --color-accent-fill: #000;\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [2, 3]);
    assert!(findings[0].2.contains("no @theme defines"), "{findings:?}");
}

#[test]
fn a_role_outside_theme_and_theme_selectors_is_reported() {
    let findings = beside_reference(
        "@utility tone-accent-soft {\n  --color-accent-wash: var(--palette-blue-600);\n}\n.panel-frame { --color-accent-ink: var(--palette-blue-600); }\n",
        RULE,
    );

    assert_eq!(lines(&findings), [2, 4]);
    assert!(findings
        .iter()
        .all(|(_, _, message)| message.contains("defined in @theme")));
}
