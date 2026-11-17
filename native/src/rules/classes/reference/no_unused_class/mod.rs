//! Definitions nothing uses: a Palette token no Role reads, a Role no colour Brick or `var()`
//! paints with, a Tone, Trait or Pattern no `@apply` names, across every configured stylesheet.
//!
//! Off by default even with a `classes` section: a design system defines building blocks before
//! anything applies them, and a generated scaffold is exactly that. Switch it on to prune.
//! Functions are not judged here, since what uses them is markup, not CSS.

use crate::rules::classes::css::index::definitions;
use crate::rules::classes::css::scan::Floor;
use crate::rules::classes::CssContext;
use crate::Diagnostic;

/// The id this rule reports under.
pub const RULE: &str = "carburetor/no-unused-class";

pub fn check(context: &CssContext<'_>) -> Vec<Diagnostic> {
    let index = context.index;
    let defined = definitions(context.scan, context.text(), context.file);
    let mut diagnostics = Vec::new();

    for definition in defined.definitions {
        let name = definition.name.as_str();
        let message = match definition.floor {
            Floor::Palette if !index.is_palette_used(name) => {
                format!("--palette-{name} is read by no Role; remove it, or point a Role at it")
            }
            Floor::Role if !index.is_role_used(name) => format!(
                "--color-{name} paints nothing: no colour Brick or var() in the configured \
                 stylesheets uses it"
            ),
            Floor::Tone | Floor::Trait | Floor::Pattern if !index.is_class_used(name) => format!(
                "{name} is a {} no @apply names; remove it, or apply it where it belongs",
                definition.floor.label()
            ),
            _ => continue,
        };
        diagnostics.push(context.report(definition.location.offset, RULE, message));
    }

    diagnostics
}

#[cfg(test)]
mod tests;
