//! `require-module-function`'s one option: where the rule looks for its finding.

use super::{malformed, ConfigError};

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
