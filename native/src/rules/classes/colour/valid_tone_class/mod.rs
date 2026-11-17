//! The Tone floor: `tone-<family>-<delivery>` and `tone-surface-<level>`, holding only `@apply` of
//! colour Bricks on Roles of its own family and the slots its delivery uses.
//!
//! A family Tone may also paint the focus ring with its family's `edge` slot under a focus
//! variant, whatever its delivery: the ring's colour belongs to the Tone, never to a Trait. A
//! surface Tone paints its own surface level plus `neutral` ink and edges.

use crate::rules::classes::css::bricks::Colour;
use crate::rules::classes::css::names::{role, tone, tone_vocabulary, RoleName, ToneName};
use crate::rules::classes::css::scan::{BlockKind, Floor};
use crate::rules::classes::{
    applied, dark_message, is_apply, node_offset, resolve, Applied, CssContext, Resolved,
};
use crate::Diagnostic;

/// The id this rule reports under.
pub const RULE: &str = "carburetor/valid-tone-class";

/// The slots a surface Tone may use from the `neutral` family.
const SURFACE_SLOTS: [&str; 3] = ["ink", "ink-subtle", "edge"];

fn is_focus_variant(variant: &str) -> bool {
    matches!(variant, "focus" | "focus-visible" | "focus-within")
        || variant.starts_with("group-focus")
        || variant.starts_with("peer-focus")
}

/// What is wrong with one Role a Tone paints with, if anything.
fn role_problem(
    applied: &Applied<'_>,
    tone_name: &str,
    parsed: ToneName<'_>,
    role_name: RoleName<'_>,
    delivery_slots: &[String],
) -> Option<String> {
    let class = applied.class;

    if let RoleName::Family {
        state: Some(state), ..
    } = role_name
    {
        if !applied
            .token
            .variants
            .iter()
            .any(|variant| variant.contains(state))
        {
            return Some(format!(
                "{class} is the {state} state of a Role; apply it under {state}:"
            ));
        }
    }

    match (parsed, role_name) {
        (
            ToneName::Family { family, delivery },
            RoleName::Family {
                family: used, slot, ..
            },
        ) => {
            if used != family {
                return Some(format!(
                    "{class} paints with the {used} family; {tone_name} uses only {family} Roles"
                ));
            }
            let focus =
                slot == "edge" && applied.token.variants.iter().any(|v| is_focus_variant(v));
            if !focus && !delivery_slots.iter().any(|known| known == slot) {
                return Some(format!(
                    "{class} uses the {slot} slot, which the {delivery} delivery does not use \
                     (it uses {})",
                    delivery_slots.join(", ")
                ));
            }
            None
        }
        (ToneName::Family { family, .. }, RoleName::Surface { .. }) => Some(format!(
            "{class} is a surface Role; {tone_name} paints with {family} Roles"
        )),
        (ToneName::Surface { level }, RoleName::Surface { level: used }) => (used != level)
            .then(|| format!("{class} paints surface-{used}; {tone_name} paints surface-{level}")),
        (ToneName::Surface { .. }, RoleName::Family { family, slot, .. }) => {
            if family != "neutral" || !SURFACE_SLOTS.contains(&slot) {
                Some(format!(
                    "{class}: a surface Tone adds only neutral ink, ink-subtle and edge Roles to \
                     its surface"
                ))
            } else {
                None
            }
        }
    }
}

pub fn check(context: &CssContext<'_>) -> Vec<Diagnostic> {
    let text = context.text();
    let mut diagnostics = Vec::new();

    for block in &context.scan.blocks {
        let BlockKind::Utility {
            name,
            floor: Floor::Tone,
        } = block.kind
        else {
            continue;
        };

        let Some(parsed) = tone(&name["tone-".len()..], context.classes) else {
            diagnostics.push(context.report(
                block.at,
                RULE,
                format!(
                    "{name} is not tone-<family>-<delivery> or tone-surface-<level> ({})",
                    tone_vocabulary(context.classes)
                ),
            ));
            continue;
        };
        let delivery_slots: &[String] = match parsed {
            ToneName::Family { delivery, .. } => context.classes.delivery(delivery).unwrap_or(&[]),
            ToneName::Surface { .. } => &[],
        };

        for node in block.nodes {
            if !is_apply(node, text) {
                diagnostics.push(context.report(
                    node_offset(node),
                    RULE,
                    format!("{name}: a Tone holds only @apply of colour Bricks"),
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
                Resolved::Unknown => None,
                Resolved::Class(floor) => Some(format!(
                    "{class} is a {}; a Tone applies only colour Bricks",
                    floor.label()
                )),
                Resolved::Brick(brick) => match brick.colour {
                    None => Some(format!(
                        "{class} is not a colour: a Tone sets colour only; {} belongs in a Trait",
                        brick.properties.names().join(", ")
                    )),
                    Some(Colour::Keyword) | Some(Colour::Unknown(_)) => None,
                    Some(Colour::Raw) => {
                        Some(format!("{class} is a raw colour; a Tone paints with Roles"))
                    }
                    Some(Colour::Role(role_token)) => {
                        role(role_token, context.classes).and_then(|role_name| {
                            role_problem(&applied, name, parsed, role_name, delivery_slots)
                        })
                    }
                },
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
