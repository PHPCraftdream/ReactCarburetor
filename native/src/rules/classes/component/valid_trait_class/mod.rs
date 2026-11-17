//! The Trait floor: `@utility <kind>-<name>`, holding non-colour Bricks and declarations of only
//! the CSS properties its kind owns. Kinds own disjoint property sets, so the order Traits are
//! applied in never decides a conflict.

use crate::config::{is_kebab, ClassesConfig};
use crate::rules::classes::css::bricks::is_colour_property;
use crate::rules::classes::css::parse::Node;
use crate::rules::classes::css::scan::{BlockKind, Floor};
use crate::rules::classes::{
    applied, dark_message, listing, node_offset, resolve, CssContext, Resolved,
};
use crate::Diagnostic;

/// The id this rule reports under.
pub const RULE: &str = "carburetor/valid-trait-class";

/// What is wrong with setting these properties from a Trait of `kind`, if anything. `what` names
/// the Brick or declaration that sets them.
fn ownership_problem(
    classes: &ClassesConfig,
    kind: &str,
    what: &str,
    properties: &[&str],
) -> Option<String> {
    let mut owners: Vec<&str> = Vec::new();
    let mut unowned: Vec<&str> = Vec::new();

    for property in properties {
        match classes.owners(property).first() {
            Some(owner) => {
                if !owners.contains(owner) {
                    owners.push(owner);
                }
            }
            None => unowned.push(property),
        }
    }

    if let Some(property) = unowned.first() {
        return Some(format!(
            "no trait kind owns {property} (set by {what}): add it to classes.traitKinds"
        ));
    }
    match owners.as_slice() {
        [only] if *only == kind => None,
        [only] => Some(format!(
            "{what} sets {}, which the {only} kind owns, not {kind}",
            listing(properties)
        )),
        several => Some(format!(
            "{what} sets properties of several kinds ({}); use Bricks that each set one kind's \
             properties",
            listing(several)
        )),
    }
}

pub fn check(context: &CssContext<'_>) -> Vec<Diagnostic> {
    let text = context.text();
    let mut diagnostics = Vec::new();

    for block in &context.scan.blocks {
        let BlockKind::Utility {
            name,
            floor: Floor::Trait,
        } = block.kind
        else {
            continue;
        };
        let kind = name.split_once('-').map_or(name, |(kind, _)| kind);

        if !is_kebab(name) {
            diagnostics.push(context.report(
                block.at,
                RULE,
                format!("{name} is not lowercase words joined by hyphens"),
            ));
        }

        for node in block.nodes {
            match node {
                Node::Declaration(declaration) => {
                    let property = declaration.name.text(text);
                    let value = declaration.value.text(text);
                    let problem = if is_colour_property(property)
                        || value.contains("var(--color-")
                        || value.contains("var(--palette-")
                    {
                        Some(format!(
                            "{property} is colour; colour belongs to Tones, not to the {name} \
                             Trait"
                        ))
                    } else {
                        ownership_problem(context.classes, kind, property, &[property])
                    };
                    if let Some(message) = problem {
                        diagnostics.push(context.report(declaration.name.start, RULE, message));
                    }
                }
                Node::At(rule) if rule.name.text(text).eq_ignore_ascii_case("apply") => {}
                other => diagnostics.push(context.report(
                    node_offset(other),
                    RULE,
                    format!(
                        "{name}: a Trait holds only @apply of Bricks and declarations of its \
                         kind's properties"
                    ),
                )),
            }
        }

        for applied in applied(block.nodes, text) {
            let class = applied.class;
            if applied.is_dark() {
                diagnostics.push(context.report(applied.offset, RULE, dark_message(class)));
                continue;
            }

            let problem = match resolve(context.index, applied.token.utility) {
                Resolved::Unknown => None,
                Resolved::Class(floor) => Some(format!(
                    "{class} is a {}; a Trait applies only Bricks",
                    floor.label()
                )),
                Resolved::Brick(brick) if brick.colour.is_some() => Some(format!(
                    "{class} is a colour; colour belongs to Tones, not to the {name} Trait"
                )),
                Resolved::Brick(brick) => {
                    ownership_problem(context.classes, kind, class, &brick.properties.names())
                }
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
