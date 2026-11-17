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
fn a_palette_token_inside_theme_is_reported() {
    let findings = beside_reference("@theme {\n  --palette-red-500: #ef4444;\n}\n", RULE);

    assert_eq!(lines(&findings), [2]);
    assert!(findings[0].2.contains("not @theme"), "{findings:?}");
}

#[test]
fn a_palette_token_outside_a_theme_selector_block_is_reported() {
    let findings = beside_reference(
        "@utility shape-wide {\n  --palette-red-500: #ef4444;\n}\n@layer components {\n  .wide-panel { --palette-x: #000; @apply shape-wide tone-accent-solid; }\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [2, 5]);
    assert!(findings
        .iter()
        .all(|(_, _, message)| message.contains("only in a theme selector block")));
}

#[test]
fn a_bad_name_and_a_var_value_are_reported() {
    let findings = beside_reference(
        ":root {\n  --palette-Red_500: #ef4444;\n  --palette-red-600: var(--palette-blue-600);\n}\n",
        RULE,
    );

    // The var() value is a non-literal Palette value, and a Palette reference from a non-Role.
    assert_eq!(lines(&findings), [2, 3, 3]);
    assert!(findings[0].2.contains("--palette-<hue>"), "{findings:?}");
    assert!(findings
        .iter()
        .any(|(_, _, message)| message.contains("literal colour")));
    assert!(findings
        .iter()
        .any(|(_, _, message)| message.contains("only Roles reference the Palette")));
}

#[test]
fn only_roles_reference_the_palette() {
    let findings = beside_reference(
        "body { color: var(--palette-gray-900); }\n@utility shape-odd { width: var(--palette-blue-600); }\n",
        RULE,
    );

    assert_eq!(lines(&findings), [1, 2]);
    assert_eq!(findings[0].1, 15);
    assert!(
        findings[0].2.contains("var(--palette-gray-900)"),
        "{findings:?}"
    );
}

#[test]
fn a_role_referencing_an_undefined_token_is_reported() {
    let findings = beside_reference(
        "[data-theme=\"dark\"] {\n  --color-accent-fill: var(--palette-blue-950);\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [2]);
    assert!(
        findings[0].2.contains("names no Palette token"),
        "{findings:?}"
    );
}

#[test]
fn a_suppression_comment_silences_exactly_the_line_below() {
    let findings = beside_reference(
        "@theme {\n  /* carburetor-disable-next-line valid-palette-token */\n  --palette-red-500: #ef4444;\n  --palette-red-600: #dc2626;\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [4]);
}
