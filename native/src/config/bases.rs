//! The `componentBases` / `storeBases` lists: extra class names the rules recognise by.

use super::{malformed, ConfigError};

/// Reads one configured base-class list: an array of non-empty, distinct names, added to the
/// built-in bases rather than replacing them, so a typo cannot silently drop a default.
pub(super) fn parse_bases(key: &str, value: &serde_json::Value) -> Result<Vec<String>, ConfigError> {
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
