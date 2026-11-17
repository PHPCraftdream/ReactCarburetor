//! What the class rules' unit tests need: an in-memory project, one stylesheet checked, and the
//! findings of one rule as `(line, column, message)`.

use std::path::Path;

use crate::config::Config;
use crate::rules::classes::css::{check_css, Project};

/// The smallest config that turns the class rules on.
pub const CONFIG: &str = r#"{"classes": {"css": ["**/*.css"]}}"#;

/// Reference CSS that every rule accepts: one of each floor, wired the way the methodology says.
pub const REFERENCE: &str = r#"@import "tailwindcss";

:root {
  --palette-blue-600: #2563eb;
  --palette-blue-700: #1d4ed8;
  --palette-gray-100: #f3f4f6;
  --palette-gray-900: #111827;
  --palette-white: #fff;
}

[data-theme="dark"] {
  --color-surface-raised: var(--palette-gray-900);
}

@theme {
  --color-*: initial;
  --color-accent-fill: var(--palette-blue-600);
  --color-accent-fill-hover: var(--palette-blue-700);
  --color-accent-on-fill: var(--palette-white);
  --color-accent-edge: var(--palette-blue-600);
  --color-accent-ink: var(--palette-blue-700);
  --color-neutral-ink: var(--palette-gray-900);
  --color-neutral-edge: var(--palette-gray-100);
  --color-surface-raised: var(--palette-gray-100);
}

@utility tone-accent-solid {
  @apply bg-accent-fill text-accent-on-fill hover:bg-accent-fill-hover focus-visible:outline-accent-edge;
}
@utility tone-accent-outline {
  @apply border-accent-edge text-accent-ink bg-transparent;
}
@utility tone-surface-raised {
  @apply bg-surface-raised text-neutral-ink border-neutral-edge;
}

@utility shape-control { @apply h-10 px-4 rounded-md border; }
@utility type-label { @apply text-sm font-medium; }
@utility layout-row { @apply flex items-center gap-2; }
@utility focus-ring { @apply outline-2 outline-offset-2; }
@utility motion-press { @apply transition duration-150 active:scale-95; }
@utility pattern-button { @apply shape-control type-label layout-row focus-ring motion-press; }
@utility pattern-card { @apply layout-row; }

@layer components {
  .submit-button { @apply pattern-button tone-accent-solid; }
  .cancel-button { @apply pattern-button tone-accent-outline; }
  .user-card {
    @apply pattern-card tone-surface-raised;
    &[aria-current="true"] { @apply tone-accent-outline; }
  }
  .user-card[data-state="busy"] { @apply tone-accent-solid; }
}
"#;

/// Checks `target` among `files` under `config` and returns `rule`'s findings, sorted.
pub fn css_with(
    config: &str,
    files: &[(&str, &str)],
    target: &str,
    rule: &str,
) -> Vec<(usize, usize, String)> {
    let mut config = Config::from_json(config).expect("test config is valid");
    let project = Project::from_texts(&config, files);
    config.set_class_index(project.index.clone());
    let file = project
        .file(&config.root().join(target))
        .expect("the target is one of the files");

    let mut findings: Vec<(usize, usize, String)> = check_css(file, Path::new(target), &config)
        .into_iter()
        .filter(|diagnostic| diagnostic.rule == rule)
        .map(|diagnostic| (diagnostic.line, diagnostic.column, diagnostic.message))
        .collect();
    findings.sort();
    findings
}

/// [`css_with`] under [`CONFIG`].
pub fn css(files: &[(&str, &str)], target: &str, rule: &str) -> Vec<(usize, usize, String)> {
    css_with(CONFIG, files, target, rule)
}

/// One stylesheet next to the reference one, checked on its own.
pub fn beside_reference(text: &str, rule: &str) -> Vec<(usize, usize, String)> {
    css(
        &[
            ("styles/reference.css", REFERENCE),
            ("styles/extra.css", text),
        ],
        "styles/extra.css",
        rule,
    )
}

/// The lines of a set of findings.
pub fn lines(findings: &[(usize, usize, String)]) -> Vec<usize> {
    findings.iter().map(|(line, _, _)| *line).collect()
}
