//! Why a configuration could not be used.

use std::path::{Path, PathBuf};

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
    pub(super) fn with_path(self, path: &Path) -> ConfigError {
        match self {
            ConfigError::Malformed { reason, .. } => ConfigError::Malformed {
                path: Some(path.to_path_buf()),
                reason,
            },
            other => other,
        }
    }
}

/// A `Malformed` error from `parse`, which has no file in hand.
pub(crate) fn malformed(reason: impl Into<String>) -> ConfigError {
    ConfigError::Malformed {
        path: None,
        reason: reason.into(),
    }
}
