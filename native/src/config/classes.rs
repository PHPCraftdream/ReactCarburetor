//! How the config ties into the functional-class rules: the `root` and `classes` keys, the class
//! rules' default severity, and the class index the run hands every per-file config.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{Map, Value};

use super::{absolute_from_cwd, malformed, Config, ConfigError, RuleSetting, Severity};
use crate::rules::classes::css::index::ClassIndex;
use crate::rules::classes::css::settings::{parse_classes, ClassesConfig};

/// The rules that check the functional-class methodology. They need the `classes` section to know
/// which CSS to read, so they stay off without it and default to `error` with it.
pub const CLASS_RULES: [&str; 10] = [
    "valid-palette-token",
    "valid-color-role",
    "valid-tone-class",
    "valid-trait-class",
    "valid-pattern-class",
    "valid-function-class",
    "no-unknown-class-reference",
    "no-duplicate-class",
    "require-function-class",
    "no-conflicting-classes",
];

/// The error for a class rule switched on without the section it checks against.
pub(super) fn class_rule_without_classes(name: &str) -> ConfigError {
    malformed(format!(
        "{name} is on but the config has no \"classes\" section, so it has no CSS to check against"
    ))
}

/// Reads the `root` and `classes` keys, and refuses a class rule switched on without `classes`.
pub(super) fn parse_project(
    object: &Map<String, Value>,
    config: &mut Config,
) -> Result<(), ConfigError> {
    if let Some(root) = object.get("root") {
        match root.as_str() {
            Some(text) if !text.is_empty() => {
                config.root_setting = Some(PathBuf::from(text));
                config.root = absolute_from_cwd(Path::new(text));
            }
            _ => {
                return Err(malformed(
                    "\"root\" must be a non-empty path, relative to the config file's directory",
                ))
            }
        }
    }

    if let Some(classes) = object.get("classes") {
        config.classes = Some(Arc::new(parse_classes(classes)?));
    }

    if config.classes.is_none() {
        let switched_on = |rules: &BTreeMap<String, RuleSetting>| {
            CLASS_RULES.iter().copied().find(|name| {
                rules
                    .get(*name)
                    .is_some_and(|setting| setting.severity != Severity::Off)
            })
        };
        if let Some(name) = switched_on(&config.rules).or_else(|| {
            config
                .overrides
                .iter()
                .find_map(|item| switched_on(&item.rules))
        }) {
            return Err(class_rule_without_classes(name));
        }
    }
    Ok(())
}

impl Config {
    /// Resolves the root against the directory of the config file: the `root` key when given,
    /// relative to that directory, otherwise the directory itself.
    pub(super) fn resolve_root(&mut self, base: &Path) {
        let joined = match &self.root_setting {
            Some(root) => base.join(root),
            None => base.to_path_buf(),
        };
        self.root = absolute_from_cwd(&joined);
    }

    /// The `classes` section, when the config has one.
    pub fn classes(&self) -> Option<&ClassesConfig> {
        self.classes.as_deref()
    }

    /// The class index built from the configured CSS, once the run has built it.
    pub fn class_index(&self) -> Option<&ClassIndex> {
        self.class_index.as_deref()
    }

    /// Hands the run's class index to this config and every per-file config cloned from it.
    pub fn set_class_index(&mut self, index: Arc<ClassIndex>) {
        self.class_index = Some(index);
    }

    /// The directory config-relative patterns (`ignore`, `overrides`, `classes.css`) resolve
    /// against.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The default severity of a class rule: `error` with a `classes` section, `off` without.
    /// `None` for every other rule.
    pub(super) fn class_rule_default(&self, name: &str) -> Option<Severity> {
        CLASS_RULES.contains(&name).then(|| {
            if self.classes.is_some() {
                Severity::Error
            } else {
                Severity::Off
            }
        })
    }

    /// Parses config text with the current directory as root, for tests that need no file.
    #[cfg(test)]
    pub fn from_json(text: &str) -> Result<Config, ConfigError> {
        super::parse(text)
    }
}
