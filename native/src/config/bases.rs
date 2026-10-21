use super::{bare_name, malformed, parse_setting, ConfigError, FileOverride, DEFAULT_SEVERITIES};
use globset::{Glob, GlobSetBuilder};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Reads one configured base-class list: an array of non-empty, distinct names, added to the
/// built-in bases rather than replacing them, so a typo cannot silently drop a default.
pub(super) fn parse_bases(
    key: &str,
    value: &serde_json::Value,
) -> Result<Vec<String>, ConfigError> {
    let Some(names) = value.as_array() else {
        return Err(malformed(format!(
            "\"{key}\" must be an array of base class names"
        )));
    };

    let mut parsed: Vec<String> = Vec::new();

    for name in names {
        let Some(name) = name.as_str() else {
            return Err(malformed(format!("\"{key}\" entries must be strings")));
        };

        if name.is_empty() {
            return Err(malformed(format!("\"{key}\" entries must not be empty")));
        }

        if parsed.iter().any(|held| held == name) {
            return Err(malformed(format!("duplicate base {name:?} in \"{key}\"")));
        }

        parsed.push(String::from(name));
    }

    Ok(parsed)
}
pub(super) fn parse_overrides(input: Option<&Value>) -> Result<Vec<FileOverride>, ConfigError> {
    let Some(input) = input else {
        return Ok(Vec::new());
    };
    let Some(entries) = input.as_array() else {
        return Err(malformed("\"overrides\" must be an array"));
    };
    let mut result = Vec::new();
    for entry in entries {
        let Some(entry) = entry.as_object() else {
            return Err(malformed("override entries must be objects"));
        };
        if entry
            .keys()
            .any(|key| !matches!(key.as_str(), "files" | "rules"))
        {
            return Err(malformed("override entries allow only files and rules"));
        }
        let Some(files) = entry.get("files").and_then(Value::as_array) else {
            return Err(malformed("override files must be an array"));
        };
        if files.is_empty() {
            return Err(malformed("override files must not be empty"));
        }
        let mut matcher = GlobSetBuilder::new();
        let mut patterns = Vec::new();
        for file in files {
            let Some(file) = file.as_str() else {
                return Err(malformed("override file patterns must be strings"));
            };
            if file.is_empty() {
                return Err(malformed("override file patterns must not be empty"));
            }
            patterns.push(file.to_string());
            matcher.add(Glob::new(&file.replace('\\', "/")).map_err(|error| {
                malformed(format!("not a valid override glob {file:?}: {error}"))
            })?);
        }
        let Some(rules) = entry.get("rules").and_then(Value::as_object) else {
            return Err(malformed("override rules must be an object"));
        };
        let mut parsed = BTreeMap::new();
        for (key, value) in rules {
            let name = bare_name(key);
            if !DEFAULT_SEVERITIES.iter().any(|(known, _)| *known == name) {
                return Err(malformed(format!("unknown rule {key:?}")));
            }
            parsed.insert(name.to_string(), parse_setting(name, value)?);
        }
        result.push(FileOverride {
            patterns,
            matcher: Arc::new(
                matcher
                    .build()
                    .map_err(|error| malformed(error.to_string()))?,
            ),
            rules: parsed,
        });
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::super::parse;
    #[test]
    fn base_lists_default_to_empty_and_extend_the_builtins() {
        let config = parse("{}").unwrap();

        assert!(config.extra_component_bases().is_empty());
        assert!(config.extra_store_bases().is_empty());

        let configured = parse(
            r#"{"componentBases": ["AppComponent"], "storeBases": ["UsersCache", "SessionCache"]}"#,
        )
        .unwrap();

        assert_eq!(configured.extra_component_bases(), ["AppComponent"]);
        assert_eq!(
            configured.extra_store_bases(),
            ["UsersCache", "SessionCache"]
        );
    }

    #[test]
    fn malformed_base_lists_are_rejected() {
        assert!(parse(r#"{"componentBases": "AppComponent"}"#).is_err());
        assert!(parse(r#"{"componentBases": [1]}"#).is_err());
        assert!(parse(r#"{"componentBases": [""]}"#).is_err());
        assert!(parse(r#"{"storeBases": ["A", "A"]}"#).is_err());
    }
}

pub(super) fn absolute_from_cwd(path: &Path) -> PathBuf {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let path = Path::new(&normalized);
    lexical_normalize(&if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    })
}

fn lexical_normalize(path: &Path) -> PathBuf {
    let replaced = path.to_string_lossy().replace('\\', "/");
    let path = Path::new(&replaced);
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

#[cfg(test)]
thread_local! {
    static OVERRIDE_MATCH_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
pub(super) fn count_override_match() {
    OVERRIDE_MATCH_COUNT.with(|counter| counter.set(counter.get() + 1));
}

#[cfg(test)]
pub(super) fn reset_override_match_count() {
    OVERRIDE_MATCH_COUNT.with(|counter| counter.set(0));
}

#[cfg(test)]
pub(super) fn override_match_count() -> usize {
    OVERRIDE_MATCH_COUNT.with(std::cell::Cell::get)
}
