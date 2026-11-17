//! The Pattern floor: `@utility pattern-<element>`, the colourless skeleton of an element, made
//! only of Traits. Colour comes from the Function's Tone; a Brick belongs in a Trait first.

use crate::config::is_kebab;
use crate::rules::classes::css::scan::{BlockKind, Floor};
use crate::rules::classes::{
    applied, dark_message, is_apply, node_offset, resolve, CssContext, Resolved,
};
use crate::Diagnostic;

/// The id this rule reports under.
pub const RULE: &str = "carburetor/valid-pattern-class";

pub fn check(context: &CssContext<'_>) -> Vec<Diagnostic> {
    let text = context.text();
    let mut diagnostics = Vec::new();

    for block in &context.scan.blocks {
        let BlockKind::Utility {
            name,
            floor: Floor::Pattern,
        } = block.kind
        else {
            continue;
        };

        if !is_kebab(name) {
            diagnostics.push(context.report(
                block.at,
                RULE,
                format!("{name} is not lowercase words joined by hyphens"),
            ));
        }

        for node in block.nodes {
            if !is_apply(node, text) {
                diagnostics.push(context.report(
                    node_offset(node),
                    RULE,
                    format!("{name}: a Pattern holds only @apply of Traits"),
                ));
            }
        }

        for applied in applied(block.nodes, text) {
            let class = applied.class;
            if applied.is_dark() {
                diagnostics.push(context.report(applied.offset, RULE, dark_message(class)));
                continue;
            }

            let problem = match resolve(context.index, applied.token.utility) {
                Resolved::Unknown | Resolved::Class(Floor::Trait) => None,
                Resolved::Class(Floor::Tone) => Some(format!(
                    "{class}: colour comes from the Function's Tone, not from the Pattern"
                )),
                Resolved::Class(floor) => Some(format!(
                    "{class} is a {}; a Pattern applies only Traits",
                    floor.label()
                )),
                Resolved::Brick(_) => Some(format!(
                    "{class} is a Brick; a Pattern applies only Traits, so put it in one"
                )),
            };

            if let Some(message) = problem {
                diagnostics.push(context.report(applied.offset, RULE, message));
            }
        }
    }

    diagnostics
}

#[cfg(test)]
mod tests;
