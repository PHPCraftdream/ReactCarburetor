//! Configuration for the linter — severities per rule, per-rule options, and extra ignore
//! patterns; defaults mirror the JavaScript preset.
//!
//! A config file is optional. It may override how hard each rule reports and add glob patterns
//! for the file walk; every rule it does not mention reports at its recommended severity, the
//! same values the ESLint preset ships.

use std::collections::BTreeMap;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use ignore::overrides::OverrideBuilder;
use serde::Serialize;

/// The "carburetor/" prefix rule ids wear in config files and diagnostics. Keys are stored and
/// matched by bare name everywhere in this module: the prefix is presentation, the bare name is
/// identity.
const PREFIX: &str = "carburetor/";

/// The config file looked up in the current directory when no explicit path is given. The name
/// mirrors `.oxlintrc.json`, the config this project already ships, so the two sit side by side
/// recognisably at a consumer's project root. JSON because serde_json is already a pinned
/// dependency and the whole toolchain — oxlint, the ESLint host, this crate — shares the format:
/// one format, no second parser. Parent directories are not searched: the bridge that invokes
/// this binary knows the project root and passes `--config` explicitly.
const CONFIG_FILE: &str = ".carburetorrc.json";

/// How hard a rule reports. Serialized lowercase, the spelling both config files and the JSON
/// output use, so a diagnostic's severity reads back as a valid config value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warn,
    Off,
}

impl Severity {
    /// The word this severity is written as, for human output and messages.
    pub fn label(self) -> &'static str {
        match self {
            Severity::Error => "error",
            Severity::Warn => "warn",
            Severity::Off => "off",
        }
    }
}

/// Parses "error"/"warn"/"off" (for the command line); anything else -> `None`.
pub fn parse_severity(text: &str) -> Option<Severity> {
    match text {
        "error" => Some(Severity::Error),
        "warn" => Some(Severity::Warn),
        "off" => Some(Severity::Off),
        _ => None,
    }
}

/// One rule's setting: how hard it reports, plus options it may consume.
#[derive(Debug, Clone, PartialEq)]
pub struct RuleSetting {
    pub severity: Severity,
    pub options: Option<serde_json::Value>,
}

/// The recommended severities, mirroring `plugin/src/recommended.mts`, which is the single source
/// of truth for strictness — this table exists so the native binary agrees with it by default, and
/// the conformance corpus is what keeps the two from drifting apart.
pub const DEFAULT_SEVERITIES: &[(&str, Severity)] = &[
    ("max-line-length", Severity::Off),
    ("max-render-depth", Severity::Warn),
    ("no-async-effect", Severity::Error),
    ("no-async-transaction", Severity::Error),
    ("no-blank-line-after-tsdoc", Severity::Off),
    ("no-closure-in-update", Severity::Warn),
    ("no-capturing-hook-selector", Severity::Warn),
    ("no-computed-get-in-computed", Severity::Error),
    ("no-computed-get-in-render", Severity::Error),
    ("no-direct-data-write", Severity::Warn),
    ("no-duplicate-effect-name", Severity::Error),
    ("no-escaping-tracked-data", Severity::Warn),
    ("no-external-data-mutation", Severity::Error),
    ("no-function-in-render", Severity::Warn),
    ("no-get-data-in-render", Severity::Error),
    ("no-handler-created-in-render", Severity::Warn),
    ("no-lifecycle-class-property", Severity::Error),
    ("no-memo-over-store-read", Severity::Warn),
    ("no-module-level-store", Severity::Off),
    ("no-parent-import", Severity::Off),
    ("no-react-hooks-in-components", Severity::Off),
    ("no-store-write-in-render", Severity::Error),
    ("no-tracked-data-mutation", Severity::Error),
    ("no-untrackable-draft-mutation", Severity::Warn),
    ("no-untrackable-store-data", Severity::Warn),
    ("no-use-carburetor-outside-render", Severity::Error),
    ("one-export-per-file", Severity::Off),
    ("require-bind-for-passed-method", Severity::Error),
    ("require-effect-deps", Severity::Warn),
    ("require-emit-after-draft-write", Severity::Error),
    ("require-method-for-closure", Severity::Warn),
    ("require-module-function", Severity::Warn),
    ("require-subscription-disposal", Severity::Warn),
    ("require-super-in-lifecycle", Severity::Error),
    ("require-tsdoc", Severity::Off),
    ("tsdoc-blank-line-before-tags", Severity::Off),
];

/// Why a configuration could not be used. `Malformed` with `path: None` comes from `parse`, which
/// has no file in hand; `load` fills the path in.
#[derive(Debug)]
pub enum ConfigError {
    /// The config file exists but could not be read.
    Unreadable {
        path: PathBuf,
        source: std::io::Error,
    },
    /// Bad JSON, or semantically invalid: unknown rule, bad severity, bad shape, bad glob,
    /// unknown key. Every one of these must fail loudly — CI's exit code 2 exists for exactly this.
    Malformed {
        path: Option<PathBuf>,
        reason: String,
    },
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigError::Unreadable { path, source } => {
                write!(
                    formatter,
                    "could not read config file {}: {source}",
                    path.display()
                )
            }
            ConfigError::Malformed { path: None, reason } => {
                write!(formatter, "invalid configuration: {reason}")
            }
            ConfigError::Malformed {
                path: Some(path),
                reason,
            } => {
                write!(
                    formatter,
                    "{} is not a valid configuration: {reason}",
                    path.display()
                )
            }
        }
    }
}

impl std::error::Error for ConfigError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            ConfigError::Unreadable { source, .. } => Some(source),
            ConfigError::Malformed { .. } => None,
        }
    }
}

impl ConfigError {
    /// Attaches the file being parsed to a `Malformed` raised by `parse`, which has no path.
    fn with_path(self, path: &Path) -> ConfigError {
        match self {
            ConfigError::Malformed { reason, .. } => ConfigError::Malformed {
                path: Some(path.to_path_buf()),
                reason,
            },
            other => other,
        }
    }
}

/// The parsed configuration: per-rule overrides, extra ignore patterns, and extra base classes
/// the rules recognise components and stores by. An empty `Config` is pure defaults — `severity`
/// falls back to `DEFAULT_SEVERITIES` for any rule not overridden, and the base lists stay the
/// built-in ones.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Config {
    // Overrides read from the config file / command line, keyed by BARE rule name (no
    // "carburetor/" prefix); rules absent from here fall back to DEFAULT_SEVERITIES.
    rules: BTreeMap<String, RuleSetting>,
    ignore: Vec<String>,
    // Extra base class names from "componentBases" / "storeBases", added to the built-ins.
    component_bases: Vec<String>,
    store_bases: Vec<String>,
}

impl Config {
    /// Reads the configuration. `None` means: look for `./.carburetorrc.json`; a missing file is
    /// not an error — the defaults apply. An explicit path is taken literally: a missing file
    /// there is `Unreadable`, because the caller asked for that exact file and silently falling
    /// back to defaults would hide the typo. Either way, a file that exists but cannot be read,
    /// parsed or validated is an error.
    pub fn load(path: Option<&Path>) -> Result<Config, ConfigError> {
        let Some(path) = path else {
            return match fs::read_to_string(CONFIG_FILE) {
                Ok(text) => parse(&text).map_err(|error| error.with_path(Path::new(CONFIG_FILE))),
                Err(error) if error.kind() == ErrorKind::NotFound => Ok(Config::default()),
                Err(error) => Err(ConfigError::Unreadable {
                    path: PathBuf::from(CONFIG_FILE),
                    source: error,
                }),
            };
        };

        let text = fs::read_to_string(path).map_err(|source| ConfigError::Unreadable {
            path: path.to_path_buf(),
            source,
        })?;

        parse(&text).map_err(|error| error.with_path(path))
    }

    /// Severity a rule reports at, given its id with or without the "carburetor/" prefix.
    pub fn severity(&self, rule: &str) -> Severity {
        let name = bare_name(rule);

        if let Some(setting) = self.rules.get(name) {
            return setting.severity;
        }

        // A name outside DEFAULT_SEVERITIES is not one of our rules, so there is nothing to
        // report: Off rather than a guess.
        DEFAULT_SEVERITIES
            .iter()
            .find(|(known, _)| *known == name)
            .map_or(Severity::Off, |(_, severity)| *severity)
    }

    /// Command-line override; error on a rule that is not in DEFAULT_SEVERITIES. Options from the
    /// config file survive: the command line argues about strictness, not about options.
    pub fn override_rule(&mut self, rule: &str, severity: Severity) -> Result<(), ConfigError> {
        let name = bare_name(rule);

        if !DEFAULT_SEVERITIES.iter().any(|(known, _)| *known == name) {
            return Err(malformed(format!("unknown rule {rule:?}")));
        }

        let options = self
            .rules
            .get(name)
            .and_then(|setting| setting.options.clone());
        self.rules
            .insert(name.to_string(), RuleSetting { severity, options });

        Ok(())
    }

    /// Glob patterns for the walker (from the config's "ignore" key).
    pub fn ignores(&self) -> &[String] {
        &self.ignore
    }

    /// Component base names the config adds to the built-in list.
    pub fn extra_component_bases(&self) -> &[String] {
        &self.component_bases
    }

    /// Store base names the config adds to the built-in list.
    pub fn extra_store_bases(&self) -> &[String] {
        &self.store_bases
    }

    /// `require-module-function`'s one option. `parse` validates the option for this rule, so a
    /// stored value is always well-formed; the `All` fallback is unreachable outside tests that
    /// build a `Config` by hand.
    pub fn module_function_scope(&self) -> ModuleFunctionScope {
        self.rules
            .get("require-module-function")
            .and_then(|setting| setting.options.as_ref())
            .and_then(|options| options.get("scope"))
            .and_then(|scope| scope.as_str())
            .and_then(ModuleFunctionScope::parse)
            .unwrap_or(ModuleFunctionScope::All)
    }

    /// Test hook: narrow the scope without going through a config file.
    #[cfg(test)]
    pub fn set_module_function_scope(&mut self, scope: ModuleFunctionScope) {
        let severity = self.severity("require-module-function");
        self.rules.insert(
            "require-module-function".to_string(),
            RuleSetting {
                severity,
                options: Some(serde_json::json!({
                    "scope": match scope {
                        ModuleFunctionScope::All => "all",
                        ModuleFunctionScope::Classes => "classes",
                    }
                })),
            },
        );
    }
}

/// The rule id a config entry or command line names, with the presentation prefix stripped.
fn bare_name(rule: &str) -> &str {
    rule.strip_prefix(PREFIX).unwrap_or(rule)
}

/// A `Malformed` error from `parse`, which has no file in hand.
fn malformed(reason: impl Into<String>) -> ConfigError {
    ConfigError::Malformed {
        path: None,
        reason: reason.into(),
    }
}

/// Reads one severity string, carrying a user-readable message on failure.
fn required_severity(text: &str) -> Result<Severity, ConfigError> {
    parse_severity(text).ok_or_else(|| {
        malformed(format!(
            "unknown severity {text:?}: expected \"error\", \"warn\" or \"off\""
        ))
    })
}

/// Reads one rule's value: a severity string, or `[severity, options]` ESLint-style. The options
/// are stored verbatim; no rule consumes them yet, but the schema has to carry them.
fn parse_setting(rule: &str, value: &serde_json::Value) -> Result<RuleSetting, ConfigError> {
    match value {
        serde_json::Value::String(text) => Ok(RuleSetting {
            severity: required_severity(text)?,
            options: None,
        }),
        serde_json::Value::Array(pair) => {
            let [severity, options] = pair.as_slice() else {
                return Err(malformed(
                    "a rule's array form must be exactly [severity, options]",
                ));
            };

            let serde_json::Value::String(text) = severity else {
                return Err(malformed(
                    "the severity in a rule's array form must be a string",
                ));
            };

            let serde_json::Value::Object(map) = options else {
                return Err(malformed("a rule's options must be a JSON object"));
            };

            // Rules that consume options validate theirs; the rest keep them verbatim, so a
            // rule can grow a schema without every other rule's config changing meaning.
            if rule == "require-module-function" {
                validate_module_function_options(map)?;
            }
            if rule == "max-render-depth" {
                validate_max_render_depth_options(map)?;
            }
            if rule == "max-line-length" {
                validate_max_line_length_options(map)?;
            }
            if rule == "no-parent-import" {
                validate_no_parent_import_options(map)?;
            }
            if rule == "require-tsdoc" {
                validate_require_tsdoc_options(map)?;
            }

            Ok(RuleSetting {
                severity: required_severity(text)?,
                options: Some(options.clone()),
            })
        }
        _ => Err(malformed(
            "a rule's value must be a severity string or a [severity, options] array",
        )),
    }
}

/// Checks that a pattern parses as a glob the walker will accept. The built override is thrown
/// away on purpose: the walk step builds its own from the same patterns later, so this is
/// validation only — better to reject a typo'd pattern here than to silently ignore files.
fn is_valid_glob(pattern: &str) -> bool {
    OverrideBuilder::new(Path::new("."))
        .add(&format!("!{pattern}"))
        .and_then(|builder| builder.build())
        .is_ok()
}

/// Parses config text. Factored out of [`Config::load`] so tests need no disk.
fn parse(text: &str) -> Result<Config, ConfigError> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|error| malformed(format!("invalid JSON: {error}")))?;

    let Some(object) = value.as_object() else {
        return Err(malformed("the top level must be a JSON object"));
    };

    for key in object.keys() {
        if !matches!(
            key.as_str(),
            "rules" | "ignore" | "componentBases" | "storeBases"
        ) {
            return Err(malformed(format!(
                "unknown key {key:?}: expected \"rules\", \"ignore\", \"componentBases\" or \"storeBases\""
            )));
        }
    }

    let mut config = Config::default();

    if let Some(rules) = object.get("rules") {
        let Some(rules) = rules.as_object() else {
            return Err(malformed("\"rules\" must be an object"));
        };

        for (key, value) in rules {
            let name = bare_name(key);

            if !DEFAULT_SEVERITIES.iter().any(|(known, _)| *known == name) {
                return Err(malformed(format!("unknown rule {key:?}")));
            }

            config
                .rules
                .insert(name.to_string(), parse_setting(name, value)?);
        }
    }

    if let Some(ignore) = object.get("ignore") {
        let Some(patterns) = ignore.as_array() else {
            return Err(malformed("\"ignore\" must be an array of glob patterns"));
        };

        for pattern in patterns {
            let Some(pattern) = pattern.as_str() else {
                return Err(malformed("\"ignore\" entries must be strings"));
            };

            if pattern.is_empty() {
                return Err(malformed("\"ignore\" entries must not be empty"));
            }

            if !is_valid_glob(pattern) {
                return Err(malformed(format!("not a valid glob pattern: {pattern:?}")));
            }

            config.ignore.push(pattern.to_string());
        }
    }

    if let Some(component) = object.get("componentBases") {
        config.component_bases = parse_bases("componentBases", component)?;
    }

    if let Some(store) = object.get("storeBases") {
        config.store_bases = parse_bases("storeBases", store)?;
    }

    Ok(config)
}

mod bases;
mod depth;
mod scope;
mod style;

use bases::parse_bases;
use depth::validate_max_render_depth_options;
pub(crate) use depth::DEFAULT_MAX;
use scope::validate_module_function_options;

pub use scope::ModuleFunctionScope;
use style::{
    validate_max_line_length_options, validate_no_parent_import_options,
    validate_require_tsdoc_options,
};
pub(crate) use style::{ImportRoot, MaxLineLengthOptions, RequireTsdocOptions};

#[cfg(test)]
mod tests;
