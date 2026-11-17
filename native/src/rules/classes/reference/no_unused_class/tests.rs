use super::RULE;
use crate::rules::classes::testing::{css_with, lines, REFERENCE};

/// The class rules on, and this one switched on too: it is off by default.
const ON: &str =
    r#"{"classes": {"css": ["**/*.css"]}, "rules": {"carburetor/no-unused-class": "warn"}}"#;

fn unused(files: &[(&str, &str)], target: &str) -> Vec<(usize, usize, String)> {
    css_with(ON, files, target, RULE)
}

#[test]
fn off_by_default_even_with_a_classes_section() {
    let text = ":root { --palette-unused: #000; }\n";
    let findings = crate::rules::classes::testing::css(&[("a.css", text)], "a.css", RULE);

    assert!(findings.is_empty(), "{findings:?}");
}

#[test]
fn every_floor_reports_what_nothing_uses() {
    let text = r#":root {
  --palette-used: #000;
  --palette-spare: #111;
}
@theme {
  --color-*: initial;
  --color-accent-fill: var(--palette-used);
  --color-accent-ink: var(--palette-used);
}
@utility tone-accent-solid { @apply bg-accent-fill; }
@utility tone-accent-plain { @apply text-accent-fill; }
@utility shape-control { @apply h-10; }
@utility shape-spare { @apply h-12; }
@utility pattern-button { @apply shape-control; }
@utility pattern-spare { @apply shape-control; }
@layer components {
  .save-button { @apply pattern-button tone-accent-solid; }
}
"#;
    let findings = unused(&[("a.css", text)], "a.css");

    assert_eq!(lines(&findings), [3, 8, 11, 13, 15]);
    assert!(
        findings[0].2.contains("--palette-spare is read by no Role"),
        "{findings:?}"
    );
    assert!(
        findings[1].2.contains("--color-accent-ink paints nothing"),
        "{findings:?}"
    );
    assert!(
        findings[2]
            .2
            .contains("tone-accent-plain is a Tone no @apply names"),
        "{findings:?}"
    );
    assert!(
        findings[3].2.contains("shape-spare is a Trait"),
        "{findings:?}"
    );
    assert!(
        findings[4].2.contains("pattern-spare is a Pattern"),
        "{findings:?}"
    );
}

#[test]
fn uses_in_other_files_and_through_var_count() {
    let tokens = ":root { --palette-ink: #000; }\n@theme {\n  --color-*: initial;\n  --color-neutral-ink: var(--palette-ink);\n}\n";
    let uses = "body { color: var(--color-neutral-ink); }\n";

    assert!(unused(&[("a.css", tokens), ("b.css", uses)], "a.css").is_empty());
}

#[test]
fn the_reference_stylesheet_uses_everything_it_defines() {
    let findings = unused(
        &[("styles/reference.css", REFERENCE)],
        "styles/reference.css",
    );

    assert!(findings.is_empty(), "{findings:?}");
}

#[test]
fn a_role_used_only_under_a_variant_or_through_the_shorthand_counts() {
    let text = ":root { --palette-a: #000; --palette-b: #111; }\n@theme {\n  --color-*: initial;\n  --color-accent-fill-hover: var(--palette-a);\n  --color-accent-edge: var(--palette-b);\n}\n@utility tone-accent-solid { @apply hover:bg-accent-fill-hover border-(--color-accent-edge); }\n@layer components { .go-button { @apply tone-accent-solid; } }\n";

    assert!(unused(&[("a.css", text)], "a.css").is_empty());
}
