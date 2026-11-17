use super::*;
use crate::config::Config;
use crate::rules::classes::css::parse::parse;

fn config(json: &str) -> Config {
    Config::from_json(json).unwrap()
}

fn kinds(text: &str) -> (Vec<String>, Vec<&'static str>) {
    let config = config(r#"{"classes": {"css": ["**/*.css"]}}"#);
    let sheet = parse(text);
    let placed = scan(&sheet, text, config.classes().unwrap());
    (
        placed
            .blocks
            .iter()
            .map(|block| format!("{:?}", block.kind))
            .collect(),
        placed.strays.iter().map(|stray| stray.message).collect(),
    )
}

#[test]
fn blocks_are_placed_through_transparent_at_rules() {
    let (blocks, strays) = kinds(
        r#"@layer base { :root { --palette-x: #000; } }
@media (prefers-contrast: more) { [data-theme="dark"] { --color-accent-fill: var(--palette-x); } }
@theme { --color-*: initial; }
@utility tone-accent-solid { @apply bg-accent-fill; }
@utility layout-row { @apply flex; }
@utility pattern-card { @apply layout-row; }
@utility submit-button { @apply p-1; }
@layer components { .user-card { @apply pattern-card; &[data-x] { @apply tone-accent-solid; } } .user-card[aria-busy] { @apply tone-accent-solid; } }
.loose-class { color: red; }
body { color: red; }
@keyframes spin { from { color: red; } }
"#,
    );

    assert_eq!(
        blocks,
        [
            "ThemeSelector",
            "ThemeSelector",
            "Theme",
            "Utility { name: \"tone-accent-solid\", floor: Tone }",
            "Utility { name: \"layout-row\", floor: Trait }",
            "Utility { name: \"pattern-card\", floor: Pattern }",
            "Utility { name: \"submit-button\", floor: Unplaced }",
            "Function { name: \"user-card\" }",
            "State { name: \"user-card\" }",
            "State { name: \"user-card\" }",
            "ClassOutside { selector: \".loose-class\" }",
        ]
    );
    assert!(strays.is_empty());
}

#[test]
fn everything_else_in_the_components_layer_is_a_stray() {
    let (blocks, strays) =
        kinds("@layer components { --x: 1; @apply p-1; .a .b { } .c:hover { } .d-e { & .f { } } }");

    assert_eq!(blocks, ["Function { name: \"d-e\" }"]);
    assert_eq!(strays.len(), 5);
}

#[test]
fn function_selectors_are_one_class_and_at_most_one_attribute() {
    assert_eq!(
        function_selector(".save-button"),
        Some(("save-button", None))
    );
    assert_eq!(
        function_selector(".save-button[data-state=\"a]b\"]"),
        Some(("save-button", Some("[data-state=\"a]b\"]")))
    );
    assert_eq!(function_selector(".a[x][y]"), None);
    assert_eq!(function_selector(".a:hover"), None);
    assert_eq!(function_selector(".a .b"), None);
    assert_eq!(function_selector(".a.b"), None);
    assert_eq!(function_selector("a"), None);
    assert_eq!(function_selector("."), None);
}

#[test]
fn theme_selectors_follow_the_configured_list() {
    let default = config(r#"{"classes": {"css": ["*.css"]}}"#);
    let classes = default.classes().unwrap();

    assert!(is_theme_selector(":root", classes));
    assert!(is_theme_selector("[data-theme=\"dark\"]", classes));
    assert!(is_theme_selector(
        ":root[data-theme='dark'], [data-theme]",
        classes
    ));
    assert!(!is_theme_selector(".dark", classes));
    assert!(!is_theme_selector(":root .x", classes));
    assert!(!is_theme_selector("html", classes));

    let custom = config(r#"{"classes": {"css": ["*.css"], "themeSelectors": [".dark", ":host"]}}"#);
    let classes = custom.classes().unwrap();
    assert!(is_theme_selector(".dark", classes));
    assert!(is_theme_selector(":host", classes));
    assert!(!is_theme_selector(":root", classes));
}

#[test]
fn class_selectors_are_found_outside_attributes_and_strings() {
    assert!(has_class_selector(".a"));
    assert!(has_class_selector("main .a > b"));
    assert!(has_class_selector(":not(.a)"));
    assert!(!has_class_selector("[data-x=\"a.b\"]"));
    assert!(!has_class_selector("a[href$='.pdf']"));
    assert!(!has_class_selector("h1"));
}
