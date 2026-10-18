//! The file walk: what is worth parsing, and what the ignore files and config exclude.

use std::fs;
use std::path::{Path, PathBuf};

use ignore::overrides::{Override, OverrideBuilder};
use ignore::WalkBuilder;

use crate::NEVER_WALK;

/// The walker's exclusions for one root: the never-walked directories plus the config's patterns.
fn exclusions(root: &Path, ignores: &[String]) -> Result<Override, String> {
    let mut builder = OverrideBuilder::new(root);

    // Only negated globs go in, so this stays a blacklist: one positive glob would turn the
    // override into a whitelist and hide every file that did not match it.
    for directory in NEVER_WALK {
        for pattern in [format!("!**/{directory}"), format!("!**/{directory}/**")] {
            builder.add(&pattern).map_err(|error| error.to_string())?;
        }
    }

    for pattern in ignores {
        builder
            .add(&format!("!{pattern}"))
            .map_err(|error| format!("not a valid ignore pattern {pattern:?}: {error}"))?;
    }

    builder.build().map_err(|error| error.to_string())
}

/// Files worth parsing: TypeScript and JavaScript, minus what the ignore files and config exclude.
pub fn collect_files(paths: &[PathBuf], ignores: &[String]) -> Result<Vec<PathBuf>, String> {
    let mut files: Vec<PathBuf> = Vec::new();

    for root in paths {
        let _metadata = fs::metadata(root)
            .map_err(|error| format!("could not access {}: {error}", root.display()))?;

        let walk = WalkBuilder::new(root)
            .hidden(false)
            .overrides(exclusions(root, ignores)?)
            .build();

        for result in walk {
            let entry = result
                .map_err(|error| format!("could not traverse {}: {error}", root.display()))?;
            if let Some(error) = entry.error() {
                return Err(format!("could not traverse {}: {error}", root.display()));
            }
            let path = entry.path();
            let is_file = match entry.file_type() {
                Some(file_type) if file_type.is_symlink() => fs::metadata(path)
                    .map_err(|error| format!("could not access {}: {error}", path.display()))?
                    .is_file(),
                Some(file_type) => file_type.is_file(),
                None => fs::metadata(path)
                    .map_err(|error| format!("could not access {}: {error}", path.display()))?
                    .is_file(),
            };
            if !is_file {
                continue;
            }

            let is_source = matches!(
                path.extension().and_then(|value| value.to_str()),
                Some("ts" | "tsx" | "mts" | "cts" | "js" | "jsx" | "mjs" | "cjs")
            );

            if is_source {
                files.push(path.to_path_buf());
            }
        }
    }

    Ok(files)
}

