//! One definition per name across every configured stylesheet: a second definition of a Palette
//! token, Role, utility or Function silently merges with or overrides the first, depending on
//! file order. Role overrides in theme selector blocks and state blocks are not definitions.

use crate::rules::classes::css::index::definitions;
use crate::rules::classes::css::scan::Floor;
use crate::rules::classes::CssContext;
use crate::Diagnostic;

/// The id this rule reports under.
pub const RULE: &str = "carburetor/no-duplicate-class";

pub fn check(context: &CssContext<'_>) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    let defined = definitions(context.scan, context.text(), context.file);

    for definition in defined.definitions {
        let Some(first) = context.index.first(definition.floor, &definition.name) else {
            continue;
        };
        if first.file == definition.location.file && first.offset == definition.location.offset {
            continue;
        }

        let shown = match definition.floor {
            Floor::Palette => format!("--palette-{}", definition.name),
            Floor::Role => format!("--color-{}", definition.name),
            _ => definition.name.clone(),
        };
        diagnostics.push(context.report(
            definition.location.offset,
            RULE,
            format!("{shown} is already defined at {}", first.label()),
        ));
    }

    diagnostics
}

#[cfg(test)]
mod tests;
