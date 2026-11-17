use super::*;
use crate::config::Config;
use crate::rules::classes::css::parse::parse;
use crate::rules::classes::css::scan::scan;

fn config() -> Config {
    Config::from_json(r#"{"classes": {"css": ["**/*.css"]}}"#).unwrap()
}

fn defined(text: &str, file: &str) -> FileDefinitions {
    let config = config();
    let sheet = parse(text);
    let placed = scan(&sheet, text, config.classes().unwrap());
    definitions(&placed, text, file)
}

#[test]
fn every_floor_is_recognised_by_name_and_place() {
    let text = r#":root { --palette-blue-600: #2563eb; --color-accent-fill: var(--palette-blue-600); }
@theme { --color-*: initial; --color-accent-fill: var(--palette-blue-600); --font-sans: x; }
@utility tone-accent-solid { @apply bg-accent-fill; }
@utility shape-control { @apply h-10; }
@utility pattern-button { @apply shape-control; }
@utility odd-thing { @apply p-1; }
@layer components {
  .submit-button { @apply pattern-button tone-accent-solid; }
  .submit-button[data-busy] { @apply tone-accent-solid; }
}
"#;
    let file = defined(text, "styles/a.css");

    assert!(file.color_reset);
    let named: Vec<(&str, Floor, usize)> = file
        .definitions
        .iter()
        .map(|definition| {
            (
                definition.name.as_str(),
                definition.floor,
                definition.location.line,
            )
        })
        .collect();
    assert_eq!(
        named,
        [
            ("blue-600", Floor::Palette, 1),
            ("accent-fill", Floor::Role, 2),
            ("tone-accent-solid", Floor::Tone, 3),
            ("shape-control", Floor::Trait, 4),
            ("pattern-button", Floor::Pattern, 5),
            ("odd-thing", Floor::Unplaced, 6),
            ("submit-button", Floor::Function, 8),
        ]
    );
}

#[test]
fn the_index_answers_by_first_definition_in_file_order() {
    let mut index = ClassIndex::default();
    index.add(defined("@utility shape-a { @apply p-1; }\n", "a.css"));
    index.add(defined(
        "\n@layer components { .shape-a { @apply p-1; } }\n",
        "b.css",
    ));

    assert_eq!(index.floor("shape-a"), Some(Floor::Trait));
    assert_eq!(
        index.first(Floor::Trait, "shape-a").unwrap().label(),
        "a.css:1"
    );
    assert_eq!(index.floor("missing"), None);
    assert!(!index.has_color_reset());
}

#[test]
fn roles_and_palette_tokens_are_looked_up_by_their_bare_names() {
    let mut index = ClassIndex::default();
    index.add(defined(
        ":root { --palette-white: #fff; }\n@theme { --color-*: initial; --color-neutral-ink: var(--palette-white); }\n",
        "a.css",
    ));

    assert!(index.is_role("neutral-ink"));
    assert!(!index.is_role("--color-neutral-ink"));
    assert!(index.is_palette("white"));
    assert!(index.has_color_reset());
    assert_eq!(index.first(Floor::Role, "neutral-ink").unwrap().line, 2);
}

#[test]
fn a_reset_other_than_initial_does_not_count() {
    assert!(!defined("@theme { --color-*: unset; }", "a.css").color_reset);
}

#[test]
fn a_project_is_ordered_by_path_whatever_order_files_arrive_in() {
    let config = config();
    let forward = crate::rules::classes::css::Project::from_texts(
        &config,
        &[
            ("a.css", "@utility shape-x { @apply p-1; }"),
            ("b.css", "@layer components { .shape-x { @apply p-1; } }"),
        ],
    );
    let backward = crate::rules::classes::css::Project::from_texts(
        &config,
        &[
            ("b.css", "@layer components { .shape-x { @apply p-1; } }"),
            ("a.css", "@utility shape-x { @apply p-1; }"),
        ],
    );

    assert_eq!(forward.index, backward.index);
    assert_eq!(forward.index.floor("shape-x"), Some(Floor::Trait));
}
