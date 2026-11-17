//! The options of `max-render-depth` and `require-module-function`: how deep one render's
//! component tree may grow, and where the module-function rule looks for its finding.

use super::{malformed, ConfigError};

/// The depth a render may reach when the config file says nothing; the rule reads it from here.
pub(crate) const DEFAULT_MAX: u32 = 3;

impl super::Config {
    /// `max-render-depth`'s one option. `parse` validates the option for this rule, so a stored
    /// value is always an integer the `u32` depth counter can hold; the default fallback is
    /// unreachable outside tests that build a `Config` by hand.
    pub fn max_render_depth(&self) -> u32 {
        match self
            .rules
            .get("max-render-depth")
            .and_then(|setting| setting.options.as_ref())
            .and_then(|options| options.get("max"))
            .and_then(|max| max.as_u64())
        {
            // Checked, not `as u32`: a wider value would otherwise wrap to a small limit.
            Some(limit) if limit <= u32::MAX as u64 => limit as u32,
            _ => DEFAULT_MAX,
        }
    }
}

/// The one option `max-render-depth` takes: `max`, an integer from 1 to `u32::MAX`. An unknown key
/// or an invalid value is a config error, not a silently ignored one — a typo'd limit would
/// otherwise read as the default and change what the rule reports.
pub(super) fn validate_max_render_depth_options(
    map: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), ConfigError> {
    for key in map.keys() {
        if key != "max" {
            return Err(malformed(format!(
                "unknown option {key:?} for max-render-depth: expected \"max\""
            )));
        }
    }

    match map.get("max") {
        None => Ok(()),
        Some(value @ serde_json::Value::Number(_)) => match value.as_u64() {
            Some(limit) if (1..=u32::MAX as u64).contains(&limit) => Ok(()),
            _ => Err(malformed(
                "the max option of max-render-depth must be an integer from 1 to 4294967295",
            )),
        },
        Some(_) => Err(malformed(
            "the max option of max-render-depth must be an integer from 1 to 4294967295",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::super::parse;

    #[test]
    fn a_valid_max_is_accepted() {
        let config = parse(r#"{"rules": {"max-render-depth": ["warn", {"max": 5}]}}"#).unwrap();
        assert_eq!(config.max_render_depth(), 5);
    }

    #[test]
    fn the_default_max_is_three() {
        let config = parse("{}").unwrap();
        assert_eq!(config.max_render_depth(), 3);
    }

    #[test]
    fn invalid_max_values_are_rejected() {
        assert!(parse(r#"{"rules": {"max-render-depth": ["warn", {"max": 0}]}}"#).is_err());
        assert!(parse(r#"{"rules": {"max-render-depth": ["warn", {"max": -1}]}}"#).is_err());
        assert!(parse(r#"{"rules": {"max-render-depth": ["warn", {"max": "many"}]}}"#).is_err());
        assert!(parse(r#"{"rules": {"max-render-depth": ["warn", {"depth": 3}]}}"#).is_err());
    }

    #[test]
    fn the_largest_u32_max_is_accepted() {
        let config =
            parse(r#"{"rules": {"max-render-depth": ["warn", {"max": 4294967295}]}}"#).unwrap();
        assert_eq!(config.max_render_depth(), 4294967295);
    }

    #[test]
    fn a_max_beyond_u32_is_rejected() {
        assert!(
            parse(r#"{"rules": {"max-render-depth": ["warn", {"max": 4294967296}]}}"#).is_err()
        );
    }
}

/// Where `carburetor/require-module-function` looks for its finding. `All` — the default —
/// covers every nested function in every file; `Classes` narrows the rule to class members,
/// the behavior the rule had before the option existed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModuleFunctionScope {
    All,
    Classes,
}

impl ModuleFunctionScope {
    /// The spelling a config file writes, and the diagnostics JSON repeats.
    pub fn parse(text: &str) -> Option<ModuleFunctionScope> {
        match text {
            "all" => Some(ModuleFunctionScope::All),
            "classes" => Some(ModuleFunctionScope::Classes),
            _ => None,
        }
    }
}

/// The one option `require-module-function` takes: `scope`, spelled "all" or "classes". An
/// unknown key or value is a config error, not a silently ignored one — a typo'd scope would
/// otherwise read as the default and change what the rule reports.
pub(super) fn validate_module_function_options(
    map: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), ConfigError> {
    for key in map.keys() {
        if key != "scope" {
            return Err(malformed(format!(
                "unknown option {key:?} for require-module-function: expected \"scope\""
            )));
        }
    }

    match map.get("scope") {
        None => Ok(()),
        Some(serde_json::Value::String(text)) => ModuleFunctionScope::parse(text).map(|_| ()).ok_or_else(|| {
            malformed(format!(
                "unknown scope {text:?} for require-module-function: expected \"all\" or \"classes\""
            ))
        }),
        Some(_) => Err(malformed(
            "the scope option of require-module-function must be a string",
        )),
    }
}
