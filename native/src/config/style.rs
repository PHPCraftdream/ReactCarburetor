//! The style rules' options: `max-line-length`, `no-parent-import` and `require-tsdoc`.
//!
//! Every option mirrors the JavaScript rule's schema one key at a time, and every one of them is
//! validated at parse: an unknown key or a wrong-typed value is a config error, not a silently
//! ignored typo — a typo'd limit would otherwise read as the default and change what the rule
//! reports.

use super::{malformed, ConfigError};

/// `max-line-length`'s options. Defaults are the JavaScript rule's: notably `ignore_strings` is
/// TRUE, deliberately unlike eslint's false — long string literals are data, not logic.
#[derive(Debug, Clone)]
pub struct MaxLineLengthOptions {
    /// The line length limit.
    pub code: u32,
    /// How many columns one tab advances to: the next multiple of this width.
    pub tab_width: u32,
    /// Skip lines carrying a `http(s)://` URL, which cannot be wrapped.
    pub ignore_urls: bool,
    /// Lines matching this regex stay unreported.
    pub ignore_pattern: Option<regex::Regex>,
    /// Skip lines the over-limit character sits inside a string literal.
    pub ignore_strings: bool,
    /// Same, for template literals specifically.
    pub ignore_template_literals: bool,
}

impl Default for MaxLineLengthOptions {
    fn default() -> Self {
        Self {
            code: 120,
            tab_width: 4,
            ignore_urls: false,
            ignore_pattern: None,
            ignore_strings: true,
            ignore_template_literals: false,
        }
    }
}

/// One source root of `no-parent-import`: where a source tree starts, and the alias it is
/// reached through. Defaults to EMPTY — with no configured roots the rule reports nothing,
/// because without knowing the tree's root an upward import has no aliased form to offer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportRoot {
    /// The tree's base directory in posix form, e.g. `lib/src`.
    pub path: String,
    /// The alias that reaches into it, e.g. `@/`.
    pub prefix: String,
}

/// `require-tsdoc`'s options; the defaults are the JavaScript rule's.
#[derive(Debug, Clone)]
pub struct RequireTsdocOptions {
    /// The longest summary the rule accepts before asking for a blank line.
    pub max_lines: u32,
    /// `access: "public"`: private and protected members are excused.
    pub public_only: bool,
    /// Overload signatures (bodies they lack) are excused.
    pub allow_overloads: bool,
    /// A pure `@inheritdoc` comment counts as documented.
    pub allow_inheritdoc: bool,
    /// Plain `get`/`set` accessors are excused.
    pub allow_trivial_accessors: bool,
    /// Every parameter (beyond a lone one) needs a `@param` tag with a description.
    pub require_param_docs: bool,
    /// Plain class fields need the doc a function gets.
    pub require_field_docs: bool,
}

impl Default for RequireTsdocOptions {
    fn default() -> Self {
        Self {
            max_lines: 3,
            public_only: false,
            allow_overloads: true,
            allow_inheritdoc: true,
            allow_trivial_accessors: false,
            require_param_docs: false,
            require_field_docs: false,
        }
    }
}

impl super::Config {
    /// `max-line-length`'s options, defaults filling whatever the config left out.
    pub fn max_line_length(&self) -> MaxLineLengthOptions {
        let read = |key: &str| {
            self.rules
                .get("max-line-length")
                .and_then(|setting| setting.options.as_ref())
                .and_then(|options| options.get(key))
        };

        // `parse` validates every stored option, so the numeric and string shapes below are
        // guaranteed; the fallbacks only serve tests that build a `Config` by hand.
        MaxLineLengthOptions {
            code: read("code")
                .and_then(|value| value.as_u64())
                .and_then(|code| u32::try_from(code).ok())
                .unwrap_or(120),
            tab_width: read("tabWidth")
                .and_then(|value| value.as_u64())
                .and_then(|width| u32::try_from(width).ok())
                .unwrap_or(4),
            ignore_urls: read("ignoreUrls")
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
            ignore_pattern: read("ignorePattern")
                .and_then(|value| value.as_str())
                .and_then(|pattern| regex::Regex::new(pattern).ok()),
            ignore_strings: read("ignoreStrings")
                .and_then(|value| value.as_bool())
                .unwrap_or(true),
            ignore_template_literals: read("ignoreTemplateLiterals")
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
        }
    }

    /// `no-parent-import`'s source roots; empty means the rule stays silent.
    pub fn no_parent_import_roots(&self) -> Vec<ImportRoot> {
        let Some(roots) = self
            .rules
            .get("no-parent-import")
            .and_then(|setting| setting.options.as_ref())
            .and_then(|options| options.get("roots"))
            .and_then(|roots| roots.as_array())
        else {
            return Vec::new();
        };

        roots
            .iter()
            .filter_map(|root| {
                let path = root.get("path")?.as_str()?;
                let prefix = root.get("prefix")?.as_str()?;

                Some(ImportRoot {
                    path: String::from(path),
                    prefix: String::from(prefix),
                })
            })
            .collect()
    }

    /// `require-tsdoc`'s options, defaults filling whatever the config left out.
    pub fn require_tsdoc(&self) -> RequireTsdocOptions {
        let read = |key: &str| {
            self.rules
                .get("require-tsdoc")
                .and_then(|setting| setting.options.as_ref())
                .and_then(|options| options.get(key))
        };

        RequireTsdocOptions {
            max_lines: read("maxLines")
                .and_then(|value| value.as_u64())
                .and_then(|lines| u32::try_from(lines).ok())
                .unwrap_or(3),
            public_only: read("access").and_then(|value| value.as_str()) == Some("public"),
            allow_overloads: read("allowOverloads")
                .and_then(|value| value.as_bool())
                .unwrap_or(true),
            allow_inheritdoc: read("allowInheritdoc")
                .and_then(|value| value.as_bool())
                .unwrap_or(true),
            allow_trivial_accessors: read("allowTrivialAccessors")
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
            require_param_docs: read("requireParamDocs")
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
            require_field_docs: read("requireFieldDocs")
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
        }
    }
}

/// Rejects any key outside a rule's schema, naming the keys it does take.
fn unknown_key(
    map: &serde_json::Map<String, serde_json::Value>,
    rule: &str,
    taken: &[&str],
) -> Result<(), ConfigError> {
    for key in map.keys() {
        if !taken.contains(&key.as_str()) {
            return Err(malformed(format!(
                "unknown option {key:?} for {rule}: expected one of {taken:?}"
            )));
        }
    }

    Ok(())
}

/// Reads one unsigned-integer option of at least `least`, fitting a `u32` — the width the rules
/// store their limits in.
fn unsigned(
    map: &serde_json::Map<String, serde_json::Value>,
    rule: &str,
    key: &str,
    least: u64,
) -> Result<(), ConfigError> {
    match map.get(key) {
        None | Some(serde_json::Value::Null) => Ok(()),
        Some(value) => match value.as_u64() {
            Some(number) if number >= least && number <= u32::MAX as u64 => Ok(()),
            _ => Err(malformed(format!(
                "the {key} option of {rule} must be an integer between {least} and {}",
                u32::MAX
            ))),
        },
    }
}

/// Reads one boolean option.
fn boolean(
    map: &serde_json::Map<String, serde_json::Value>,
    rule: &str,
    key: &str,
) -> Result<(), ConfigError> {
    match map.get(key) {
        None | Some(serde_json::Value::Null) => Ok(()),
        Some(serde_json::Value::Bool(_)) => Ok(()),
        Some(_) => Err(malformed(format!(
            "the {key} option of {rule} must be a boolean"
        ))),
    }
}

/// The one schema `max-line-length` takes.
pub(super) fn validate_max_line_length_options(
    map: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), ConfigError> {
    unknown_key(
        map,
        "max-line-length",
        &[
            "code",
            "tabWidth",
            "ignoreUrls",
            "ignorePattern",
            "ignoreStrings",
            "ignoreTemplateLiterals",
        ],
    )?;

    unsigned(map, "max-line-length", "code", 1)?;
    unsigned(map, "max-line-length", "tabWidth", 1)?;
    boolean(map, "max-line-length", "ignoreUrls")?;
    boolean(map, "max-line-length", "ignoreStrings")?;
    boolean(map, "max-line-length", "ignoreTemplateLiterals")?;

    match map.get("ignorePattern") {
        None | Some(serde_json::Value::Null) => Ok(()),
        Some(serde_json::Value::String(pattern)) => {
            regex::Regex::new(pattern).map(|_| ()).map_err(|_| {
                malformed(format!(
                    "the ignorePattern option of max-line-length is not a valid regex in the \
                     Rust regex syntax (lookaround and backreferences of JavaScript RegExp are \
                     not supported): {pattern:?}"
                ))
            })
        }
        Some(_) => Err(malformed(
            "the ignorePattern option of max-line-length must be a string regex",
        )),
    }
}

/// The one schema `no-parent-import` takes: `roots`, an array of `{path, prefix}` objects.
pub(super) fn validate_no_parent_import_options(
    map: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), ConfigError> {
    unknown_key(map, "no-parent-import", &["roots"])?;

    let Some(roots) = map.get("roots") else {
        return Ok(());
    };

    let Some(roots) = roots.as_array() else {
        return Err(malformed(
            "the roots option of no-parent-import must be an array of {path, prefix} objects",
        ));
    };

    for root in roots {
        let Some(root) = root.as_object() else {
            return Err(malformed(
                "each root of no-parent-import must be an object with path and prefix",
            ));
        };

        for key in root.keys() {
            if key != "path" && key != "prefix" {
                return Err(malformed(format!(
                    "unknown key {key:?} in a no-parent-import root: expected \"path\" and \"prefix\""
                )));
            }
        }

        let Some(path) = root.get("path") else {
            return Err(malformed("a no-parent-import root needs a \"path\" string"));
        };
        let Some(prefix) = root.get("prefix") else {
            return Err(malformed(
                "a no-parent-import root needs a \"prefix\" string",
            ));
        };

        if path.as_str().is_none() || prefix.as_str().is_none() {
            return Err(malformed(
                "the path and prefix of a no-parent-import root must be strings",
            ));
        }
    }

    Ok(())
}

/// The one schema `require-tsdoc` takes.
pub(super) fn validate_require_tsdoc_options(
    map: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), ConfigError> {
    unknown_key(
        map,
        "require-tsdoc",
        &[
            "maxLines",
            "access",
            "allowOverloads",
            "allowInheritdoc",
            "allowTrivialAccessors",
            "requireParamDocs",
            "requireFieldDocs",
        ],
    )?;

    unsigned(map, "require-tsdoc", "maxLines", 0)?;
    boolean(map, "require-tsdoc", "allowOverloads")?;
    boolean(map, "require-tsdoc", "allowInheritdoc")?;
    boolean(map, "require-tsdoc", "allowTrivialAccessors")?;
    boolean(map, "require-tsdoc", "requireParamDocs")?;
    boolean(map, "require-tsdoc", "requireFieldDocs")?;

    match map.get("access") {
        None | Some(serde_json::Value::Null) => Ok(()),
        Some(serde_json::Value::String(text)) if text == "all" || text == "public" => Ok(()),
        Some(_) => Err(malformed(
            "the access option of require-tsdoc must be \"all\" or \"public\"",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::super::parse;
    use crate::config::{MaxLineLengthOptions, RequireTsdocOptions};

    #[test]
    fn max_line_length_defaults_match_the_javascript_rule() {
        let config = parse("{}").unwrap();
        let options = config.max_line_length();

        // The getter and the manual `Default` hold the same JavaScript values; keeping them
        // equal field by field is what lets the rule read either one.
        let defaults = MaxLineLengthOptions::default();
        assert_eq!(options.code, defaults.code);
        assert_eq!(options.tab_width, defaults.tab_width);
        assert_eq!(options.ignore_urls, defaults.ignore_urls);
        assert_eq!(
            options.ignore_pattern.is_some(),
            defaults.ignore_pattern.is_some()
        );
        assert_eq!(options.ignore_strings, defaults.ignore_strings);
        assert_eq!(
            options.ignore_template_literals,
            defaults.ignore_template_literals
        );

        assert_eq!(options.code, 120);
        assert_eq!(options.tab_width, 4);
        assert!(!options.ignore_urls);
        assert!(options.ignore_pattern.is_none());
        // Deliberately unlike eslint: long string literals are data, not logic.
        assert!(options.ignore_strings);
        assert!(!options.ignore_template_literals);
    }

    #[test]
    fn max_line_length_reads_its_options() {
        let config = parse(
            r#"{"rules": {"max-line-length": ["warn", {"code": 80, "tabWidth": 2,
                "ignoreUrls": true, "ignorePattern": "^// padding", "ignoreStrings": false,
                "ignoreTemplateLiterals": true}]}}"#,
        )
        .unwrap();
        let options = config.max_line_length();

        assert_eq!(options.code, 80);
        assert_eq!(options.tab_width, 2);
        assert!(options.ignore_urls);
        assert!(options
            .ignore_pattern
            .is_some_and(|pattern| pattern.is_match("// padding x")));
        assert!(!options.ignore_strings);
        assert!(options.ignore_template_literals);
    }

    #[test]
    fn max_line_length_rejects_unknown_and_mistyped_options() {
        assert!(parse(r#"{"rules": {"max-line-length": ["warn", {"max": 80}]}}"#).is_err());
        assert!(parse(r#"{"rules": {"max-line-length": ["warn", {"code": 0}]}}"#).is_err());
        assert!(
            parse(r#"{"rules": {"max-line-length": ["warn", {"tabWidth": "wide"}]}}"#).is_err()
        );
        assert!(
            parse(r#"{"rules": {"max-line-length": ["warn", {"ignoreUrls": "yes"}]}}"#).is_err()
        );
        assert!(
            parse(r#"{"rules": {"max-line-length": ["warn", {"ignorePattern": 7}]}}"#).is_err()
        );
        assert!(
            parse(r#"{"rules": {"max-line-length": ["warn", {"ignorePattern": "(["}]}}"#).is_err()
        );
    }

    #[test]
    fn numeric_options_must_fit_a_u32() {
        assert!(
            parse(r#"{"rules": {"max-line-length": ["warn", {"tabWidth": 4294967296}]}}"#).is_err()
        );
        assert!(
            parse(r#"{"rules": {"max-line-length": ["warn", {"code": 4294967296}]}}"#).is_err()
        );
        assert!(
            parse(r#"{"rules": {"require-tsdoc": ["warn", {"maxLines": 4294967296}]}}"#).is_err()
        );
        assert!(parse(r#"{"rules": {"max-line-length": ["warn", {"tabWidth": 0}]}}"#).is_err());
        assert!(
            parse(r#"{"rules": {"max-line-length": ["warn", {"tabWidth": 4294967295}]}}"#).is_ok()
        );
    }

    #[test]
    fn an_ignore_pattern_with_a_lookahead_names_the_regex_syntax_in_the_error() {
        let error = parse(
            r#"{"rules": {"max-line-length": ["warn", {"ignorePattern": "^// (?=generated)"}]}}"#,
        )
        .expect_err("lookahead is not Rust-regex");

        assert!(
            error.to_string().contains("Rust regex syntax"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn no_parent_import_roots_default_to_empty() {
        assert!(parse("{}").unwrap().no_parent_import_roots().is_empty());

        let config = parse(
            r#"{"rules": {"no-parent-import": ["warn", {"roots": [
                {"path": "lib/src", "prefix": "@/"}
            ]}]}}"#,
        )
        .unwrap();

        assert_eq!(
            config.no_parent_import_roots(),
            [super::ImportRoot {
                path: String::from("lib/src"),
                prefix: String::from("@/")
            }]
        );
    }

    #[test]
    fn no_parent_import_rejects_unknown_and_mistyped_options() {
        assert!(parse(r#"{"rules": {"no-parent-import": ["warn", {"root": 1}]}}"#).is_err());
        assert!(
            parse(r#"{"rules": {"no-parent-import": ["warn", {"roots": "lib/src"}]}}"#).is_err()
        );
        assert!(
            parse(r#"{"rules": {"no-parent-import": ["warn", {"roots": [{"path": "a"}]}]}}"#)
                .is_err()
        );
        assert!(parse(
            r#"{"rules": {"no-parent-import": ["warn", {"roots": [{"path": 1, "prefix": "@"}]}]}}"#
        )
        .is_err());
        assert!(parse(
            r#"{"rules": {"no-parent-import": ["warn", {"roots": [{"path": "a", "prefix": "@", "x": 1}]}]}}"#
        )
        .is_err());
    }

    #[test]
    fn require_tsdoc_defaults_match_the_javascript_rule() {
        let config = parse("{}").unwrap();
        let options = config.require_tsdoc();
        let defaults = RequireTsdocOptions::default();

        assert_eq!(options.max_lines, defaults.max_lines);
        assert_eq!(options.public_only, defaults.public_only);
        assert_eq!(options.allow_overloads, defaults.allow_overloads);
        assert_eq!(options.allow_inheritdoc, defaults.allow_inheritdoc);
        assert_eq!(
            options.allow_trivial_accessors,
            defaults.allow_trivial_accessors
        );
        assert_eq!(options.require_param_docs, defaults.require_param_docs);
        assert_eq!(options.require_field_docs, defaults.require_field_docs);

        assert_eq!(options.max_lines, 3);
        assert!(!options.public_only);
        assert!(options.allow_overloads);
        assert!(options.allow_inheritdoc);
        assert!(!options.allow_trivial_accessors);
        assert!(!options.require_param_docs);
        assert!(!options.require_field_docs);
    }

    #[test]
    fn require_tsdoc_reads_its_options() {
        let config = parse(
            r#"{"rules": {"require-tsdoc": ["warn", {"maxLines": 5, "access": "public",
                "allowOverloads": false, "allowInheritdoc": false, "allowTrivialAccessors": true,
                "requireParamDocs": true, "requireFieldDocs": true}]}}"#,
        )
        .unwrap();
        let options = config.require_tsdoc();

        assert_eq!(options.max_lines, 5);
        assert!(options.public_only);
        assert!(!options.allow_overloads);
        assert!(!options.allow_inheritdoc);
        assert!(options.allow_trivial_accessors);
        assert!(options.require_param_docs);
        assert!(options.require_field_docs);
    }

    #[test]
    fn require_tsdoc_rejects_unknown_and_mistyped_options() {
        assert!(parse(r#"{"rules": {"require-tsdoc": ["warn", {"lines": 3}]}}"#).is_err());
        assert!(parse(r#"{"rules": {"require-tsdoc": ["warn", {"maxLines": -1}]}}"#).is_err());
        assert!(
            parse(r#"{"rules": {"require-tsdoc": ["warn", {"access": "internal"}]}}"#).is_err()
        );
        assert!(
            parse(r#"{"rules": {"require-tsdoc": ["warn", {"allowOverloads": "yes"}]}}"#).is_err()
        );
    }
}
