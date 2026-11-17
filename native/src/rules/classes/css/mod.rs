//! The CSS side of the functional-class methodology: the scanner, the Brick vocabulary, floor
//! placement, the project-wide class index, and the per-file CSS check.
//!
//! A run with a `classes` section first loads every configured CSS file — in parallel, once — into
//! a [`Project`]; its index is handed to the config, so the markup rule sees it from any TSX file
//! and the CSS rules see it from any stylesheet. Only then are files checked.

pub mod bricks;
pub mod index;
pub mod names;
pub mod parse;
pub mod scan;
pub mod settings;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use rayon::prelude::*;

use crate::config::{absolute_from_cwd, relative_to, ClassesConfig, Config};
use crate::suppression::Suppression;
use crate::walk::collect_files;
use crate::{rules, Diagnostic, Source};
use index::{definitions, ClassIndex, FileDefinitions};
use parse::Sheet;

/// One configured stylesheet, read and scanned.
#[derive(Debug)]
pub struct CssFile {
    /// Absolute path.
    pub path: PathBuf,
    /// Path relative to the config root, with `/` separators.
    pub relative: String,
    pub text: String,
    pub sheet: Sheet,
}

/// Every configured stylesheet and the index built from them.
#[derive(Debug)]
pub struct Project {
    files: Vec<CssFile>,
    by_path: HashMap<PathBuf, usize>,
    pub index: Arc<ClassIndex>,
}

/// The literal directory a glob starts with: the components before the first one holding a glob
/// character, and never the last component, which names files. `src/styles/**/*.css` starts at
/// `src/styles`, `**/*.css` at the root.
fn glob_base(pattern: &str) -> String {
    let components: Vec<&str> = pattern.split('/').collect();
    let literal = components[..components.len().saturating_sub(1)]
        .iter()
        .take_while(|component| {
            !component.is_empty() && *component != &"." && !component.contains(['*', '?', '[', '{'])
        })
        .copied()
        .collect::<Vec<&str>>();

    literal.join("/")
}

/// The existing directories to walk for the stylesheets the globs name, with none inside
/// another; the root when any glob starts there.
fn walk_bases(root: &Path, patterns: &[String]) -> Vec<PathBuf> {
    let mut bases: Vec<PathBuf> = patterns
        .iter()
        .map(|pattern| root.join(glob_base(pattern)))
        .filter(|base| base.is_dir())
        .collect();
    bases.sort();
    bases.dedup();

    let mut kept: Vec<PathBuf> = Vec::new();
    for base in bases {
        if !kept.iter().any(|outer| base.starts_with(outer)) {
            kept.push(base);
        }
    }
    kept
}

/// Whether `path` is one of the configured stylesheets.
pub fn is_configured_css(config: &Config, path: &Path) -> bool {
    let Some(classes) = config.classes() else {
        return false;
    };
    path.extension().and_then(|value| value.to_str()) == Some("css")
        && relative_to(config.root(), &absolute_from_cwd(path))
            .is_some_and(|relative| classes.is_css(&relative))
}

impl Project {
    /// Loads every stylesheet `classes.css` matches under the config root. `stdin` replaces one
    /// file's content with an unsaved buffer, so an editor checking that file sees its own text.
    pub fn load(config: &Config, stdin: Option<(&Path, &str)>) -> Result<Project, String> {
        let root = config.root().to_path_buf();
        let accept = |path: &Path| is_configured_css(config, path);
        // Only the directories the globs can match under are walked, not the whole project: an
        // editor's `--stdin` run builds this index on every buffer.
        let bases: Vec<PathBuf> = config
            .classes()
            .map(|classes| walk_bases(&root, &classes.css))
            .unwrap_or_default();
        let mut paths: Vec<PathBuf> = collect_files(
            &bases,
            config.ignores(),
            Some(&accept as &dyn Fn(&Path) -> bool),
        )?
        .into_iter()
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("css"))
        .map(|path| absolute_from_cwd(&path))
        .collect();

        let stdin = stdin
            .filter(|(path, _)| is_configured_css(config, path))
            .map(|(path, text)| (absolute_from_cwd(path), text));
        if let Some((path, _)) = &stdin {
            paths.push(path.clone());
        }
        paths.sort();
        paths.dedup();

        let classes = config
            .classes()
            .ok_or_else(|| "the class rules need a \"classes\" section".to_string())?;
        let texts: Vec<(PathBuf, String)> = paths
            .par_iter()
            .map(|path| {
                let text = match &stdin {
                    Some((stdin_path, text)) if stdin_path == path => text.to_string(),
                    _ => fs::read_to_string(path)
                        .map_err(|error| format!("could not read {}: {error}", path.display()))?,
                };
                Ok((path.clone(), text))
            })
            .collect::<Result<_, String>>()?;

        Ok(Project::build(&root, classes, texts))
    }

    /// A project from texts in memory, for tests: `(path relative to the config root, text)`.
    #[cfg(test)]
    pub fn from_texts(config: &Config, files: &[(&str, &str)]) -> Project {
        let root = config.root().to_path_buf();
        let mut texts: Vec<(PathBuf, String)> = files
            .iter()
            .map(|(relative, text)| (absolute_from_cwd(&root.join(relative)), text.to_string()))
            .collect();
        texts.sort();
        let classes = config.classes().expect("test config has a classes section");

        Project::build(&root, classes, texts)
    }

    /// Scans sorted `(absolute path, text)` pairs in parallel and indexes them in order.
    fn build(root: &Path, classes: &ClassesConfig, texts: Vec<(PathBuf, String)>) -> Project {
        let loaded: Vec<(CssFile, FileDefinitions)> = texts
            .into_par_iter()
            .map(|(path, text)| {
                let relative = relative_to(root, &path)
                    .unwrap_or_else(|| path.to_string_lossy().replace('\\', "/"));
                let sheet = parse::parse(&text);
                let placed = scan::scan(&sheet, &text, classes);
                let defined = definitions(&placed, &text, &relative);

                (
                    CssFile {
                        path,
                        relative,
                        text,
                        sheet,
                    },
                    defined,
                )
            })
            .collect();

        let mut index = ClassIndex::default();
        let mut files = Vec::with_capacity(loaded.len());
        for (file, defined) in loaded {
            index.add(defined);
            files.push(file);
        }
        let by_path = files
            .iter()
            .enumerate()
            .map(|(position, file)| (file.path.clone(), position))
            .collect();

        Project {
            files,
            by_path,
            index: Arc::new(index),
        }
    }

    /// The loaded stylesheet at `path`, if it is one of them.
    pub fn file(&self, path: &Path) -> Option<&CssFile> {
        self.by_path
            .get(&absolute_from_cwd(path))
            .map(|position| &self.files[*position])
    }
}

/// Runs the CSS rules over one loaded stylesheet, reporting under `report_path`. A stylesheet the
/// scanner could not make sense of is not checked — rules over half a tree would guess — but it
/// is not silent either: one `valid-function-class` finding at the first problem says the file
/// went unchecked, so a broken stylesheet cannot pass as a clean one.
pub fn check_css(file: &CssFile, report_path: &Path, config: &Config) -> Vec<Diagnostic> {
    let (Some(classes), Some(index)) = (config.classes(), config.class_index()) else {
        return Vec::new();
    };

    let source = Source::new(report_path, &file.text);
    let suppression = Suppression::from_comments(
        &file.text,
        file.sheet
            .comments
            .iter()
            .map(|comment| (comment.content.text(&file.text), comment.end)),
    );

    if let Some(error) = file.sheet.errors.first() {
        let rule = rules::classes::component::valid_function_class::RULE;
        let severity = config.severity(rule);
        if severity == crate::config::Severity::Off {
            return Vec::new();
        }
        let mut diagnostic = rules::report(
            &source,
            error.offset,
            rule,
            format!(
                "{}, so no class rule checked this stylesheet; Tailwind's build names the same                  problem",
                error.message
            ),
        );
        diagnostic.severity = severity;
        return [diagnostic]
            .into_iter()
            .filter(|diagnostic| !suppression.silenced(&diagnostic.rule, diagnostic.line))
            .collect();
    }

    let placed = scan::scan(&file.sheet, &file.text, classes);
    let context = rules::classes::CssContext {
        source: &source,
        sheet: &file.sheet,
        scan: &placed,
        index,
        classes,
        file: &file.relative,
    };

    rules::classes::run_css(&context, config)
        .into_iter()
        .filter(|diagnostic| !suppression.silenced(&diagnostic.rule, diagnostic.line))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{glob_base, walk_bases};

    #[test]
    fn a_glob_starts_at_its_literal_directories() {
        assert_eq!(glob_base("src/styles/**/*.css"), "src/styles");
        assert_eq!(glob_base("src/styles/app.css"), "src/styles");
        assert_eq!(glob_base("**/*.css"), "");
        assert_eq!(glob_base("*.css"), "");
        assert_eq!(glob_base("src/{a,b}/*.css"), "src");
        assert_eq!(glob_base("./src/*.css"), "");
    }

    #[test]
    fn nested_and_missing_bases_collapse() {
        let root = std::env::temp_dir().join(format!("carburetor-bases-{}", std::process::id()));
        std::fs::create_dir_all(root.join("src/styles/deep")).unwrap();

        let bases = walk_bases(
            &root,
            &[
                "src/styles/deep/*.css".to_string(),
                "src/styles/**/*.css".to_string(),
                "missing/*.css".to_string(),
            ],
        );
        assert_eq!(bases, [root.join("src/styles")]);

        let everything = walk_bases(&root, &["src/a.css".to_string(), "**/*.css".to_string()]);
        assert_eq!(everything, [root.join("")]);

        std::fs::remove_dir_all(&root).unwrap();
    }
}
