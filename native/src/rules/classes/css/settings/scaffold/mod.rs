//! `carburetor-lint --init-classes <path>`: writes a stylesheet with every floor of the
//! methodology laid out and filled with base classes — a Palette, the Roles of every configured
//! family and slot behind the `--color-*` reset, a Tone per family and delivery plus the surface
//! Tones, base Traits of every kind, Patterns over them, and a few example Functions.
//!
//! The vocabulary comes from the config's `classes` section when there is one, the defaults
//! otherwise, and what is written passes every class rule under that vocabulary: a Trait whose
//! Bricks the configured kinds do not own, or a Function whose Pattern or Tone is missing, is left
//! out rather than written wrong.

use std::fs;
use std::path::Path;

use super::ClassesConfig;
use crate::config::{absolute_from_cwd, relative_to, Config};
use crate::rules::classes::css::bricks::{classify, split};

mod palette;

use palette::{hue_of, Palette};

/// How many classes of each floor a scaffold wrote, for the summary line.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Counts {
    pub palette: usize,
    pub roles: usize,
    pub tones: usize,
    pub traits: usize,
    pub patterns: usize,
    pub functions: usize,
}

/// The base Traits: name and Bricks. Each is written only when its kind exists and owns every
/// property its Bricks set.
const TRAITS: [(&str, &[&str]); 13] = [
    ("shape-control", &["h-10", "px-4", "rounded-md", "border"]),
    ("shape-field", &["h-10", "px-3", "rounded-md", "border"]),
    ("shape-panel", &["p-4", "rounded-lg", "border"]),
    ("shape-badge", &["px-2", "py-0.5", "rounded-full", "border"]),
    ("type-body", &["text-base", "font-normal"]),
    ("type-label", &["text-sm", "font-medium"]),
    ("type-heading", &["text-xl", "font-semibold"]),
    ("layout-row", &["flex", "items-center", "gap-2"]),
    ("layout-stack", &["flex", "flex-col", "gap-4"]),
    ("focus-ring", &["outline-2", "outline-offset-2"]),
    (
        "motion-press",
        &["transition", "duration-150", "active:scale-95"],
    ),
    ("effect-raised", &["shadow-md"]),
    ("behavior-clickable", &["cursor-pointer", "select-none"]),
];

/// The base Patterns: name and the Traits they combine. A Trait that was not written is dropped
/// from the list; a Pattern left with none is not written.
const PATTERNS: [(&str, &[&str]); 4] = [
    (
        "pattern-button",
        &[
            "shape-control",
            "type-label",
            "layout-row",
            "focus-ring",
            "motion-press",
            "behavior-clickable",
        ],
    ),
    ("pattern-field", &["shape-field", "type-body", "focus-ring"]),
    (
        "pattern-card",
        &["shape-panel", "layout-stack", "effect-raised"],
    ),
    (
        "pattern-badge",
        &["shape-badge", "type-label", "layout-row"],
    ),
];

/// The example Functions: name, Pattern, Tone. Written only when both exist.
const FUNCTIONS: [(&str, &str, &str); 6] = [
    ("submit-button", "pattern-button", "tone-accent-solid"),
    ("cancel-button", "pattern-button", "tone-neutral-outline"),
    ("delete-button", "pattern-button", "tone-danger-solid"),
    ("search-field", "pattern-field", "tone-surface-raised"),
    ("content-card", "pattern-card", "tone-surface-raised"),
    ("status-badge", "pattern-badge", "tone-neutral-soft"),
];

/// The state blocks of `status-badge`: attribute value and the family whose soft Tone it swaps in.
const BADGE_STATES: [&str; 3] = ["success", "warning", "danger"];

/// The step of a family's hue a slot paints with; `None` is the palette's white.
fn slot_step(slot: &str) -> Option<u32> {
    match slot {
        "on-fill" => None,
        "fill" => Some(600),
        "wash" => Some(50),
        "ink" => Some(700),
        "ink-subtle" => Some(500),
        "edge" => Some(300),
        _ => Some(500),
    }
}

/// The step a slot's state paints with: one step darker on hover, two when active.
fn state_step(slot: &str, state: &str) -> u32 {
    match (slot, state) {
        ("wash", "active") => 300,
        ("wash", _) => 100,
        (_, "active") => 800,
        _ => 700,
    }
}

/// States Tailwind has a variant of the same name for.
const VARIANTS: [&str; 7] = [
    "hover",
    "active",
    "focus",
    "focus-visible",
    "disabled",
    "visited",
    "checked",
];

/// The slots that get state Roles: the ones a Tone paints a background with.
const STATEFUL_SLOTS: [&str; 2] = ["fill", "wash"];

/// The Brick that paints a slot of a family, if the slot has a conventional utility.
fn slot_brick(family: &str, slot: &str) -> Option<String> {
    match slot {
        "fill" | "wash" => Some(format!("bg-{family}-{slot}")),
        "on-fill" | "ink" | "ink-subtle" => Some(format!("text-{family}-{slot}")),
        "edge" => Some(format!("border-{family}-edge")),
        _ => None,
    }
}

/// The surface level's light and dark palette references.
fn surface_steps(level: &str) -> (Option<u32>, u32) {
    match level {
        "raised" => (Some(50), 900),
        "sunken" => (Some(100), 950),
        "overlay" => (None, 800),
        _ => (None, 950),
    }
}

/// The scaffold's text and what it holds.
pub fn generate(classes: &ClassesConfig) -> (String, Counts) {
    let mut counts = Counts::default();
    let mut palette = Palette::default();
    let has = |list: &[String], item: &str| list.iter().any(|known| known == item);
    let neutral = has(&classes.families, "neutral");

    // Roles first, so the palette holds exactly the hues and steps they reference.
    let mut roles = String::new();
    let mut role_names: Vec<String> = Vec::new();
    for family in &classes.families {
        let hue = hue_of(family);
        for slot in &classes.slots {
            let step = slot_step(slot);
            roles += &format!("  --color-{family}-{slot}: {};\n", palette.take(&hue, step));
            role_names.push(format!("{family}-{slot}"));
            if STATEFUL_SLOTS.contains(&slot.as_str()) {
                for state in &classes.states {
                    let step = Some(state_step(slot, state));
                    roles += &format!(
                        "  --color-{family}-{slot}-{state}: {};\n",
                        palette.take(&hue, step)
                    );
                    role_names.push(format!("{family}-{slot}-{state}"));
                }
            }
        }
    }
    // The dark theme exists only where a `[data-theme]` selector may override Roles; without it,
    // its palette steps would be tokens nothing reads.
    let themed = classes
        .theme_selectors
        .iter()
        .any(|selector| selector == "[data-theme]");
    let mut dark = String::new();
    for level in &classes.surface_levels {
        let (light, night) = surface_steps(level);
        roles += &format!(
            "  --color-surface-{level}: {};\n",
            palette.take("gray", light)
        );
        role_names.push(format!("surface-{level}"));
        if !themed {
            continue;
        }
        dark += &format!(
            "  --color-surface-{level}: {};\n",
            palette.take("gray", Some(night))
        );
    }
    if neutral && themed {
        for (slot, night) in [("ink", 100), ("ink-subtle", 300), ("edge", 700)] {
            if has(&classes.slots, slot) {
                dark += &format!(
                    "  --color-neutral-{slot}: {};\n",
                    palette.take("gray", Some(night))
                );
            }
        }
    }
    counts.roles = role_names.len();
    let is_role = |name: &str| role_names.iter().any(|known| known == name);

    // Tones.
    let mut tones = String::new();
    let mut tone_names: Vec<String> = Vec::new();
    for family in &classes.families {
        for (delivery, slots) in &classes.deliveries {
            let mut bricks: Vec<String> = Vec::new();
            for slot in slots {
                let Some(brick) = slot_brick(family, slot) else {
                    continue;
                };
                bricks.push(brick.clone());
                if STATEFUL_SLOTS.contains(&slot.as_str()) {
                    for state in &classes.states {
                        // A state Tailwind has no variant for gets its Role, but no Brick: the
                        // author decides which variant (or `@custom-variant`) expresses it.
                        if VARIANTS.contains(&state.as_str())
                            && is_role(&format!("{family}-{slot}-{state}"))
                        {
                            bricks.push(format!("{state}:{brick}-{state}"));
                        }
                    }
                }
            }
            if bricks.is_empty() {
                continue;
            }
            if has(&classes.slots, "edge") {
                bricks.push(format!("focus-visible:outline-{family}-edge"));
            }
            let name = format!("tone-{family}-{delivery}");
            tones += &utility(&name, &bricks);
            tone_names.push(name);
        }
    }
    for level in &classes.surface_levels {
        let mut bricks = vec![format!("bg-surface-{level}")];
        if neutral {
            for (slot, prefix) in [("ink", "text"), ("edge", "border")] {
                if has(&classes.slots, slot) {
                    bricks.push(format!("{prefix}-neutral-{slot}"));
                }
            }
        }
        let name = format!("tone-surface-{level}");
        tones += &utility(&name, &bricks);
        tone_names.push(name);
    }
    counts.tones = tone_names.len();

    // Traits: only those whose kind owns every property they set.
    let mut traits = String::new();
    let mut trait_names: Vec<&str> = Vec::new();
    for (name, bricks) in TRAITS {
        let kind = name.split('-').next().unwrap_or(name);
        if classes.trait_kind(kind).is_none() {
            continue;
        }
        let owned = bricks.iter().all(|brick| {
            classify(split(brick).utility, &|_| false).is_some_and(|found| {
                found.colour.is_none()
                    && found
                        .properties
                        .names()
                        .iter()
                        .all(|property| classes.owners(property) == [kind])
            })
        });
        if owned {
            let bricks: Vec<String> = bricks.iter().map(|brick| brick.to_string()).collect();
            traits += &utility(name, &bricks);
            trait_names.push(name);
        }
    }
    counts.traits = trait_names.len();

    // Patterns over the Traits that exist.
    let mut patterns = String::new();
    let mut pattern_names: Vec<&str> = Vec::new();
    for (name, uses) in PATTERNS {
        let present: Vec<String> = uses
            .iter()
            .filter(|used| trait_names.contains(used))
            .map(|used| used.to_string())
            .collect();
        if !present.is_empty() {
            patterns += &utility(name, &present);
            pattern_names.push(name);
        }
    }
    counts.patterns = pattern_names.len();

    // Example Functions.
    let tone_exists = |name: &str| tone_names.iter().any(|known| known == name);
    let mut functions = String::new();
    for (name, pattern, tone) in FUNCTIONS {
        let first = name.split('-').next().unwrap_or(name);
        if classes.is_reserved(first) || !pattern_names.contains(&pattern) || !tone_exists(tone) {
            continue;
        }
        functions += &format!("  .{name} {{\n    @apply {pattern} {tone};\n");
        if name == "status-badge" {
            for state in BADGE_STATES {
                let swapped = format!("tone-{state}-soft");
                if tone_exists(&swapped) {
                    functions += &format!(
                        "\n    &[data-status=\"{state}\"] {{\n      @apply {swapped};\n    }}\n"
                    );
                }
            }
        }
        functions += "  }\n";
        counts.functions += 1;
    }

    counts.palette = palette.len();
    let dark_block = if themed && !dark.is_empty() {
        format!(
            "\n/* Themes override Roles, never Tones: dark surfaces and neutral ink. */\n[data-theme=\"dark\"] {{\n{dark}}}\n"
        )
    } else {
        String::new()
    };

    let text = format!(
        "/*\n * Functional classes, generated by `carburetor-lint --init-classes`.\n *\n * Each floor uses only the floor under it, and markup carries only Functions:\n *   Palette → Role → Tone                   (colour)\n *   Brick → Trait → Pattern → Function       (components)\n * See docs/functional-classes.md in @react-carburetor/core.\n */\n\n\
         /* Palette: raw colours, outside @theme so Tailwind makes no utilities of them. */\n:root {{\n{}}}\n{dark_block}\n\
         /* Roles: what a colour is for. The reset removes the stock palette (bg-blue-600 and friends). */\n@theme {{\n  --color-*: initial;\n{roles}}}\n\n\
         /* Tones: the colour of a component, one family and delivery each. */\n{tones}\n\
         /* Traits: one kind of property each, no colour. */\n{traits}\n\
         /* Patterns: the colourless skeleton of an element. */\n{patterns}\n\
         /* Functions: what markup carries. Replace these examples with your own. */\n@layer components {{\n{functions}}}\n",
        palette.declarations()
    );

    (text, counts)
}

/// `@utility name { @apply …; }`, one Brick per line when the list is long.
fn utility(name: &str, bricks: &[String]) -> String {
    let joined = bricks.join(" ");
    if joined.len() + name.len() < 80 {
        format!("@utility {name} {{\n  @apply {joined};\n}}\n")
    } else {
        format!(
            "@utility {name} {{\n  @apply\n    {};\n}}\n",
            bricks.join("\n    ")
        )
    }
}

/// Writes the scaffold to `target` and ties it into the config; returns the report to print.
/// `config` is the `--config` path, if one was given.
pub fn init(config: Option<&Path>, target: &Path) -> Result<String, String> {
    if target.exists() {
        return Err(format!(
            "{} already exists; --init-classes never overwrites a stylesheet",
            target.display()
        ));
    }

    let config_path = config.unwrap_or(Path::new(".carburetorrc.json"));
    let existing = config_path.exists();
    let loaded = if existing {
        Some(Config::load(Some(config_path)).map_err(|error| error.to_string())?)
    } else {
        None
    };
    let base = config_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let root = loaded.as_ref().map_or_else(
        || absolute_from_cwd(base),
        |loaded| loaded.root().to_path_buf(),
    );
    let glob = relative_to(&root, &absolute_from_cwd(target))
        .unwrap_or_else(|| target.to_string_lossy().replace('\\', "/"));

    let defaults;
    let classes = match loaded.as_ref().and_then(|loaded| loaded.classes()) {
        Some(classes) => classes,
        None => {
            defaults = super::parse_classes(&serde_json::json!({"css": [glob.clone()]}))
                .map_err(|error| error.to_string())?;
            &defaults
        }
    };

    let (text, counts) = generate(classes);
    if let Some(parent) = target
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    }
    fs::write(target, text)
        .map_err(|error| format!("could not write {}: {error}", target.display()))?;

    let mut report = format!(
        "wrote {}: {} palette tokens, {} roles, {} tones, {} traits, {} patterns, {} example functions",
        target.display(),
        counts.palette,
        counts.roles,
        counts.tones,
        counts.traits,
        counts.patterns,
        counts.functions
    );
    let section = serde_json::json!({"classes": {"css": [glob.clone()]}});
    match &loaded {
        None => {
            let text = serde_json::to_string_pretty(&section).unwrap_or_default() + "\n";
            fs::write(config_path, text)
                .map_err(|error| format!("could not write {}: {error}", config_path.display()))?;
            report += &format!(
                "\ncreated {} with a classes section, so the class rules check it",
                config_path.display()
            );
        }
        Some(loaded) if loaded.classes().is_none() => {
            report += &format!(
                "\n{} has no classes section; add this to turn the class rules on:\n  \"classes\": {{\"css\": [\"{glob}\"]}}",
                config_path.display()
            );
        }
        Some(loaded)
            if !loaded
                .classes()
                .is_some_and(|classes| classes.is_css(&glob)) =>
        {
            report += &format!(
                "\nclasses.css in {} does not match {glob}; add it so the class rules read it",
                config_path.display()
            );
        }
        Some(_) => {}
    }

    Ok(report)
}

#[cfg(test)]
mod tests;
