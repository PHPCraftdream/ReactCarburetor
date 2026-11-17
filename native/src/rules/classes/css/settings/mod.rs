//! The `classes` section: the CSS files the functional-class rules read, and the closed
//! vocabularies the methodology's names are built from. See
//! `docs/functional-classes.md` for the methodology itself.

use std::path::Path;
use std::sync::Arc;

use globset::{Glob, GlobSet, GlobSetBuilder};
use serde_json::{Map, Value};

mod defaults;

use super::bricks::KNOWN_PROPERTIES;
use crate::config::{malformed, ConfigError};
use defaults::{default_deliveries, default_trait_kinds, strings};

/// Words a Function name may not start with: the trait kinds, plus the prefixes of the other
/// floors. A Function called `tone-x` or `shape-y` would be read as the floor it names.
const FLOOR_WORDS: [&str; 4] = ["pattern", "tone", "palette", "color"];

/// The family name surfaces use; configured families may not take it.
pub const SURFACE: &str = "surface";

/// The validated `classes` section.
#[derive(Debug, Clone)]
pub struct ClassesConfig {
    pub css: Vec<String>,
    matcher: Arc<GlobSet>,
    pub theme_selectors: Vec<String>,
    pub families: Vec<String>,
    pub slots: Vec<String>,
    pub states: Vec<String>,
    pub deliveries: Vec<(String, Vec<String>)>,
    pub surface_levels: Vec<String>,
    pub trait_kinds: Vec<(String, Vec<String>)>,
}

impl PartialEq for ClassesConfig {
    fn eq(&self, other: &Self) -> bool {
        self.css == other.css
            && self.theme_selectors == other.theme_selectors
            && self.families == other.families
            && self.slots == other.slots
            && self.states == other.states
            && self.deliveries == other.deliveries
            && self.surface_levels == other.surface_levels
            && self.trait_kinds == other.trait_kinds
    }
}

impl ClassesConfig {
    /// Whether a path relative to the config root (with `/` separators) is one of the CSS files.
    pub fn is_css(&self, relative: &str) -> bool {
        self.matcher.is_match(relative)
    }

    /// The delivery's slots, if the delivery exists.
    pub fn delivery(&self, name: &str) -> Option<&[String]> {
        self.deliveries
            .iter()
            .find(|(delivery, _)| delivery == name)
            .map(|(_, slots)| slots.as_slice())
    }

    /// The property patterns a trait kind owns, if the kind exists.
    pub fn trait_kind(&self, name: &str) -> Option<&[String]> {
        self.trait_kinds
            .iter()
            .find(|(kind, _)| kind == name)
            .map(|(_, properties)| properties.as_slice())
    }

    /// The trait kinds whose patterns match a CSS property.
    pub fn owners(&self, property: &str) -> Vec<&str> {
        self.trait_kinds
            .iter()
            .filter(|(_, patterns)| {
                patterns
                    .iter()
                    .any(|pattern| wildcard_match(pattern, property))
            })
            .map(|(kind, _)| kind.as_str())
            .collect()
    }

    /// Whether a word is reserved as the first word of a Function name.
    pub fn is_reserved(&self, word: &str) -> bool {
        FLOOR_WORDS.contains(&word) || self.trait_kind(word).is_some()
    }

    /// Every reserved word, for messages.
    pub fn reserved_words(&self) -> Vec<&str> {
        self.trait_kinds
            .iter()
            .map(|(kind, _)| kind.as_str())
            .chain(FLOOR_WORDS)
            .collect()
    }
}

/// `*` matches any run of characters, including none; everything else matches itself.
pub fn wildcard_match(pattern: &str, text: &str) -> bool {
    let pattern = pattern.as_bytes();
    let text = text.as_bytes();
    let (mut p, mut t) = (0usize, 0usize);
    let mut star: Option<(usize, usize)> = None;

    while t < text.len() {
        if p < pattern.len() && pattern[p] == b'*' {
            star = Some((p, t));
            p += 1;
        } else if p < pattern.len() && pattern[p] == text[t] {
            p += 1;
            t += 1;
        } else if let Some((star_p, star_t)) = star {
            p = star_p + 1;
            t = star_t + 1;
            star = Some((star_p, star_t + 1));
        } else {
            return false;
        }
    }

    pattern[p..].iter().all(|byte| *byte == b'*')
}

/// Lowercase words joined by single hyphens: `on-fill`, `ink-subtle`, `2xl`.
pub fn is_kebab(name: &str) -> bool {
    !name.is_empty()
        && name.split('-').all(|word| {
            !word.is_empty()
                && word
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

fn word_list(
    key: &str,
    value: Option<&Value>,
    default: &[&str],
) -> Result<Vec<String>, ConfigError> {
    let Some(value) = value else {
        return Ok(strings(default));
    };
    let Some(items) = value.as_array() else {
        return Err(malformed(format!(
            "\"classes.{key}\" must be an array of words"
        )));
    };

    let mut words: Vec<String> = Vec::new();
    for item in items {
        let Some(word) = item.as_str() else {
            return Err(malformed(format!(
                "\"classes.{key}\" entries must be strings"
            )));
        };
        if !is_kebab(word) {
            return Err(malformed(format!(
                "\"classes.{key}\" entry {word:?} must be lowercase words joined by hyphens"
            )));
        }
        if words.iter().any(|known| known == word) {
            return Err(malformed(format!("\"classes.{key}\" lists {word:?} twice")));
        }
        words.push(word.to_string());
    }

    if words.is_empty() {
        return Err(malformed(format!("\"classes.{key}\" must not be empty")));
    }

    Ok(words)
}

fn word_map(
    key: &str,
    value: Option<&Value>,
    default: Vec<(String, Vec<String>)>,
    entry: &dyn Fn(&str, &str) -> Result<(), ConfigError>,
) -> Result<Vec<(String, Vec<String>)>, ConfigError> {
    let Some(value) = value else {
        return Ok(default);
    };
    let Some(object) = value.as_object() else {
        return Err(malformed(format!("\"classes.{key}\" must be an object")));
    };
    if object.is_empty() {
        return Err(malformed(format!("\"classes.{key}\" must not be empty")));
    }

    let mut result = Vec::new();
    for (name, items) in object {
        if !is_kebab(name) {
            return Err(malformed(format!(
                "\"classes.{key}\" name {name:?} must be lowercase words joined by hyphens"
            )));
        }
        let Some(items) = items.as_array() else {
            return Err(malformed(format!(
                "\"classes.{key}.{name}\" must be an array of strings"
            )));
        };
        if items.is_empty() {
            return Err(malformed(format!(
                "\"classes.{key}.{name}\" must not be empty"
            )));
        }
        let mut list = Vec::new();
        for item in items {
            let Some(item) = item.as_str() else {
                return Err(malformed(format!(
                    "\"classes.{key}.{name}\" entries must be strings"
                )));
            };
            entry(name, item)?;
            list.push(item.to_string());
        }
        result.push((name.clone(), list));
    }

    Ok(result)
}

/// Parses and validates the `classes` section.
pub(crate) fn parse_classes(value: &Value) -> Result<ClassesConfig, ConfigError> {
    let Some(object) = value.as_object() else {
        return Err(malformed("\"classes\" must be an object"));
    };

    for key in object.keys() {
        if !matches!(
            key.as_str(),
            "css"
                | "themeSelectors"
                | "families"
                | "slots"
                | "states"
                | "deliveries"
                | "surfaceLevels"
                | "traitKinds"
        ) {
            return Err(malformed(format!(
                "unknown key \"classes.{key}\": expected \"css\", \"themeSelectors\", \"families\", \"slots\", \"states\", \"deliveries\", \"surfaceLevels\" or \"traitKinds\""
            )));
        }
    }

    let (css, matcher) = parse_css(object)?;
    let theme_selectors = parse_theme_selectors(object.get("themeSelectors"))?;
    let families = word_list(
        "families",
        object.get("families"),
        &["neutral", "accent", "danger", "success", "warning"],
    )?;
    let slots = word_list(
        "slots",
        object.get("slots"),
        &["fill", "on-fill", "wash", "ink", "ink-subtle", "edge"],
    )?;
    let states = word_list("states", object.get("states"), &["hover", "active"])?;
    let surface_levels = word_list(
        "surfaceLevels",
        object.get("surfaceLevels"),
        &["page", "raised", "sunken", "overlay"],
    )?;

    if let Some(family) = families
        .iter()
        .find(|family| family.as_str() == SURFACE || family.starts_with("surface-"))
    {
        return Err(malformed(format!(
            "\"classes.families\" entry {family:?} collides with the surface family: surfaces have their own levels"
        )));
    }

    let deliveries = word_map(
        "deliveries",
        object.get("deliveries"),
        default_deliveries(),
        &|delivery, slot| {
            if slots.iter().any(|known| known == slot) {
                Ok(())
            } else {
                Err(malformed(format!(
                    "\"classes.deliveries.{delivery}\" uses slot {slot:?}, which \"classes.slots\" does not list"
                )))
            }
        },
    )?;

    let trait_kinds = word_map(
        "traitKinds",
        object.get("traitKinds"),
        default_trait_kinds(),
        &|kind, pattern| {
            let valid = !pattern.is_empty()
                && pattern.bytes().all(|byte| {
                    byte.is_ascii_lowercase()
                        || byte.is_ascii_digit()
                        || matches!(byte, b'-' | b'*')
                });
            if !valid {
                return Err(malformed(format!(
                    "\"classes.traitKinds.{kind}\" pattern {pattern:?} must be a property name, with `*` as a wildcard"
                )));
            }
            if let Some(colour) = KNOWN_COLOUR_PROPERTIES
                .iter()
                .find(|property| wildcard_match(pattern, property))
            {
                return Err(malformed(format!(
                    "\"classes.traitKinds.{kind}\" pattern {pattern:?} covers the colour property {colour}: colour belongs to Tones"
                )));
            }
            Ok(())
        },
    )?;

    for (kind, _) in &trait_kinds {
        if FLOOR_WORDS.contains(&kind.as_str()) || kind == SURFACE {
            return Err(malformed(format!(
                "\"classes.traitKinds\" kind {kind:?} is a reserved floor word"
            )));
        }
    }

    let config = ClassesConfig {
        css,
        matcher,
        theme_selectors,
        families,
        slots,
        states,
        deliveries,
        surface_levels,
        trait_kinds,
    };

    for property in KNOWN_PROPERTIES {
        let owners = config.owners(property);
        if owners.len() > 1 {
            return Err(malformed(format!(
                "\"classes.traitKinds\": {property} is owned by both {} and {}; each property belongs to one kind, so @apply order never decides a conflict",
                owners[0], owners[1]
            )));
        }
    }

    Ok(config)
}

/// Colour properties a trait-kind pattern must not reach.
const KNOWN_COLOUR_PROPERTIES: [&str; 15] = [
    "color",
    "background-color",
    "border-color",
    "outline-color",
    "ring-color",
    "ring-offset-color",
    "shadow-color",
    "text-shadow-color",
    "text-decoration-color",
    "fill",
    "stroke",
    "caret-color",
    "accent-color",
    "gradient-color",
    "background",
];

fn parse_css(object: &Map<String, Value>) -> Result<(Vec<String>, Arc<GlobSet>), ConfigError> {
    let Some(value) = object.get("css") else {
        return Err(malformed(
            "\"classes.css\" is required: the glob patterns of the CSS files that define the classes",
        ));
    };
    let Some(items) = value.as_array() else {
        return Err(malformed(
            "\"classes.css\" must be an array of glob patterns",
        ));
    };
    if items.is_empty() {
        return Err(malformed("\"classes.css\" must not be empty"));
    }

    let mut patterns = Vec::new();
    let mut builder = GlobSetBuilder::new();
    for item in items {
        let Some(pattern) = item.as_str() else {
            return Err(malformed("\"classes.css\" entries must be strings"));
        };
        if pattern.is_empty() {
            return Err(malformed("\"classes.css\" entries must not be empty"));
        }
        let normalized = pattern.replace('\\', "/");
        let glob = Glob::new(&normalized)
            .map_err(|error| malformed(format!("not a valid glob pattern {pattern:?}: {error}")))?;
        builder.add(glob);
        patterns.push(normalized);
    }
    let matcher = builder
        .build()
        .map_err(|error| malformed(format!("\"classes.css\": {error}")))?;

    Ok((patterns, Arc::new(matcher)))
}

fn parse_theme_selectors(value: Option<&Value>) -> Result<Vec<String>, ConfigError> {
    let Some(value) = value else {
        return Ok(strings(&[":root", "[data-theme]"]));
    };
    let Some(items) = value.as_array() else {
        return Err(malformed(
            "\"classes.themeSelectors\" must be an array of selectors",
        ));
    };

    let mut selectors = Vec::new();
    for item in items {
        let Some(selector) = item.as_str() else {
            return Err(malformed(
                "\"classes.themeSelectors\" entries must be strings",
            ));
        };
        let is_pseudo = selector.starts_with(':')
            && selector.len() > 1
            && selector[1..]
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte == b'-');
        let is_attribute = selector.starts_with('[')
            && selector.ends_with(']')
            && selector.len() > 2
            && selector[1..selector.len() - 1]
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-');
        let is_class = selector.starts_with('.') && is_kebab(&selector[1..]);
        if !(is_pseudo || is_attribute || is_class) {
            return Err(malformed(format!(
                "\"classes.themeSelectors\" entry {selector:?} must be a pseudo-class (:root), an attribute name ([data-theme]) or a class (.dark)"
            )));
        }
        selectors.push(selector.to_string());
    }
    if selectors.is_empty() {
        return Err(malformed("\"classes.themeSelectors\" must not be empty"));
    }

    Ok(selectors)
}

/// Whether a path relative to `root` matches; paths outside `root` never do.
pub fn relative_to(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
}

/// Keeps the import of `is_colour_property` honest: raw declarations are judged by it, config by
/// the explicit list above, and the two must agree on every listed name.
#[cfg(test)]
pub(crate) fn colour_lists_agree() -> bool {
    KNOWN_COLOUR_PROPERTIES
        .iter()
        .all(|property| super::bricks::is_colour_property(property))
}
