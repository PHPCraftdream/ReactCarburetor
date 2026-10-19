//! `max-render-depth`'s one option: how deep one render's component tree may grow.

use super::{malformed, ConfigError};

/// The depth a render may reach when the config file says nothing; the rule reads it from here.
pub(crate) const DEFAULT_MAX: u32 = 3;

impl super::Config {
    /// `max-render-depth`'s one option. `parse` validates the option for this rule, so a stored
    /// value is always a well-formed integer; the default fallback is unreachable outside tests
    /// that build a `Config` by hand.
    pub fn max_render_depth(&self) -> u32 {
        self.rules
            .get("max-render-depth")
            .and_then(|setting| setting.options.as_ref())
            .and_then(|options| options.get("max"))
            .and_then(|max| max.as_u64())
            .map_or(DEFAULT_MAX, |limit| limit as u32)
    }
}

/// The one option `max-render-depth` takes: `max`, an integer >= 1. An unknown key or an invalid
/// value is a config error, not a silently ignored one — a typo'd limit would otherwise read as
/// the default and change what the rule reports.
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
            Some(limit) if limit >= 1 => Ok(()),
            _ => Err(malformed(
                "the max option of max-render-depth must be an integer >= 1",
            )),
        },
        Some(_) => Err(malformed(
            "the max option of max-render-depth must be an integer >= 1",
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
}
