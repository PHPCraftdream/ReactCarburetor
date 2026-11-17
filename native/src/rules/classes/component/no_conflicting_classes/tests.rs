use super::RULE;
use crate::rules::classes::testing::{beside_reference, css, every_rule, lines, CONFIG, REFERENCE};

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
fn two_bricks_with_one_property_in_a_trait_are_reported_at_the_second() {
    let findings = beside_reference("@utility shape-wide {\n  @apply px-4 h-10 px-2;\n}\n", RULE);

    assert_eq!(lines(&findings), [2]);
    assert_eq!(findings[0].1, 20);
    assert!(
        findings[0]
            .2
            .contains("px-2 sets padding-inline, which px-4 already sets in shape-wide"),
        "{findings:?}"
    );
}

#[test]
fn a_declaration_and_a_brick_for_one_property_conflict() {
    let findings = beside_reference(
        "@utility shape-wide {\n  @apply h-10;\n  height: 3rem;\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [3]);
    assert!(
        findings[0].2.contains("height sets height, which h-10"),
        "{findings:?}"
    );
}

#[test]
fn two_traits_of_one_kind_in_a_pattern_or_function_are_reported() {
    let findings = beside_reference(
        "@utility shape-tall { @apply h-16; }\n@utility pattern-tall { @apply shape-control shape-tall; }\n@layer components {\n  .tall-button { @apply pattern-button shape-tall tone-accent-solid; }\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [2, 4]);
    assert!(
        findings[0]
            .2
            .contains("shape-tall sets height, which shape-control already sets in pattern-tall"),
        "{findings:?}"
    );
    assert!(
        findings[1]
            .2
            .contains("which pattern-button already sets in tall-button"),
        "{findings:?}"
    );
}

#[test]
fn variants_are_their_own_slots_but_the_same_variant_conflicts() {
    let clean = beside_reference(
        "@utility shape-grow {\n  @apply h-10 md:h-12 hover:h-14;\n}\n",
        RULE,
    );
    assert!(clean.is_empty(), "{clean:?}");

    let findings = beside_reference(
        "@utility shape-grow {\n  @apply md:h-12 md:h-14;\n}\n",
        RULE,
    );
    assert_eq!(lines(&findings), [2]);
    assert!(findings[0].2.contains("height under md:"), "{findings:?}");
}

#[test]
fn colours_conflict_inside_a_tone() {
    let findings = beside_reference(
        "@utility tone-accent-plain {\n  @apply text-accent-ink text-accent-ink;\n}\n",
        RULE,
    );

    assert_eq!(lines(&findings), [2]);
    assert!(findings[0].2.contains("sets color"), "{findings:?}");
}

#[test]
fn properties_tailwind_composes_are_not_conflicts() {
    let findings = beside_reference(
        "@utility motion-soft {\n  @apply transition duration-150 scale-95 rotate-3 blur-sm grayscale;\n}\n@utility type-snug {\n  @apply text-sm leading-6;\n}\n@utility shape-round {\n  @apply rounded-md rounded-t-lg;\n}\n",
        RULE,
    );

    assert!(findings.is_empty(), "{findings:?}");
}

#[test]
fn a_class_that_applies_itself_does_not_hang() {
    let findings = beside_reference(
        "@utility shape-loop {\n  @apply shape-loop h-10;\n}\n",
        RULE,
    );

    // The class's own body reaches its height first; the run ends instead of recursing forever.
    assert_eq!(lines(&findings), [2]);
}

#[test]
fn the_init_classes_scaffold_has_no_conflicts() {
    let config = crate::config::Config::from_json(CONFIG).unwrap();
    let (text, _) =
        crate::rules::classes::css::settings::scaffold::generate(config.classes().unwrap());

    let findings = every_rule(
        CONFIG,
        &[("styles/classes.css", &text)],
        "styles/classes.css",
    );
    assert!(findings.is_empty(), "{findings:?}");
}
