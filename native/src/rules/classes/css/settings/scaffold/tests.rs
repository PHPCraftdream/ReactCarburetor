use super::generate;
use crate::config::Config;
use crate::rules::classes::testing::every_rule;

fn scaffold(config: &str) -> (String, super::Counts) {
    let config = Config::from_json(config).unwrap();
    generate(config.classes().unwrap())
}

#[test]
fn the_default_scaffold_passes_every_class_rule() {
    let config = r#"{"classes": {"css": ["**/*.css"]}}"#;
    let (text, counts) = scaffold(config);

    let findings = every_rule(
        config,
        &[("styles/classes.css", &text)],
        "styles/classes.css",
    );
    assert!(findings.is_empty(), "{findings:?}\n{text}");

    // Five families × six slots, two states on fill and wash, four surfaces.
    assert_eq!(counts.roles, 5 * 6 + 5 * 2 * 2 + 4);
    // Five families × five deliveries, plus four surface Tones.
    assert_eq!(counts.tones, 5 * 5 + 4);
    assert_eq!(counts.traits, 13);
    assert_eq!(counts.patterns, 4);
    assert_eq!(counts.functions, 6);
    assert!(text.contains("--color-*: initial;"));
    assert!(text.contains("[data-theme=\"dark\"]"));
    assert!(text.contains("&[data-status=\"success\"]"));
}

#[test]
fn a_custom_vocabulary_scaffolds_its_own_floors_and_still_passes() {
    let config = r#"{"classes": {"css": ["**/*.css"], "families": ["brand", "neutral"], "slots": ["fill", "on-fill", "ink", "edge", "glow"], "states": ["pressed"], "deliveries": {"filled": ["fill", "on-fill"], "quiet": ["ink", "glow"]}, "surfaceLevels": ["base"], "themeSelectors": [":root"], "traitKinds": {"box": ["padding*", "height", "border-*radius", "border-*width"], "type": ["font-*", "line-height"]}}}"#;
    let (text, counts) = scaffold(config);

    let findings = every_rule(
        config,
        &[("styles/classes.css", &text)],
        "styles/classes.css",
    );
    assert!(findings.is_empty(), "{findings:?}\n{text}");

    assert!(text.contains("--palette-brand-600"));
    assert!(text.contains("--color-brand-fill-pressed"));
    assert!(!text.contains(" pressed:bg-"));
    assert!(text.contains("@utility tone-brand-filled"));
    assert!(text.contains("@utility tone-surface-base"));
    assert!(
        !text.contains("[data-theme"),
        "no [data-theme] selector configured"
    );
    // Only the type Traits fit these kinds (`shape-*` has no kind here), and `pressed` has no
    // Tailwind variant, so it gets a Role but no Brick.
    assert_eq!(counts.traits, 3);
    assert!(text.contains("@utility type-label"));
    assert!(!text.contains("@utility shape-control"));
    // No accent or danger family and no outline delivery: no example Function has its Tone.
    assert_eq!(counts.functions, 0);
}

#[test]
fn the_scaffold_is_deterministic() {
    let config = r#"{"classes": {"css": ["**/*.css"]}}"#;

    assert_eq!(scaffold(config).0, scaffold(config).0);
}
