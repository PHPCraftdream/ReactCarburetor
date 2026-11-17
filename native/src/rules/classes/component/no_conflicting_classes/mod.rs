//! One composition, one value per property. The methodology promises that the order classes are
//! applied in never decides anything; two classes of one `@apply` list that both set the same
//! property under the same variants (`px-4 px-4`, `h-10 h-12`, `shape-control shape-panel`, a
//! Pattern and a Trait both setting the height) break that promise, and Tailwind's own ordering
//! picks the winner.
//!
//! Classes are expanded through the index — a Function into its Pattern, Traits and Tone, a
//! Pattern into its Traits, a Trait into its Bricks and declarations — and only properties where
//! two values overwrite each other are compared. Properties Tailwind composes through its own
//! variables (filters, transforms, `transition` with `duration-*`, `text-*` with `leading-*`) and
//! the canonical names that merge several sides (`border-radius` for every `rounded-*`) are left
//! alone.

use std::collections::{BTreeSet, HashMap};

use crate::rules::classes::css::bricks::{classify, split};
use crate::rules::classes::css::index::ClassIndex;
use crate::rules::classes::css::parse::Node;
use crate::rules::classes::css::scan::BlockKind;
use crate::rules::classes::{applied, CssContext};
use crate::Diagnostic;

/// The id this rule reports under.
pub const RULE: &str = "carburetor/no-conflicting-classes";

/// Properties where a second value replaces the first outright.
const EXCLUSIVE: &[&str] = &[
    "width",
    "height",
    "min-width",
    "min-height",
    "max-width",
    "max-height",
    "aspect-ratio",
    "padding",
    "padding-inline",
    "padding-block",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "padding-inline-start",
    "padding-inline-end",
    "margin",
    "margin-inline",
    "margin-block",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "margin-inline-start",
    "margin-inline-end",
    "gap",
    "column-gap",
    "row-gap",
    "font-size",
    "font-weight",
    "font-family",
    "letter-spacing",
    "text-align",
    "text-transform",
    "white-space",
    "display",
    "position",
    "flex-direction",
    "flex-wrap",
    "flex",
    "align-items",
    "align-self",
    "justify-content",
    "z-index",
    "opacity",
    "box-shadow",
    "border-width",
    "border-style",
    "outline-width",
    "outline-style",
    "outline-offset",
    "cursor",
    "overflow",
    "overflow-x",
    "overflow-y",
    "top",
    "right",
    "bottom",
    "left",
    "inset",
    "visibility",
    "pointer-events",
    "user-select",
    "color",
    "background-color",
    "border-color",
    "outline-color",
    "text-decoration-color",
    "fill",
    "stroke",
];

/// How deep a class is followed into the classes it applies; a cycle stops here.
const MAX_DEPTH: usize = 8;

/// A property under a set of variants: what two classes must share to overwrite each other.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct Slot {
    /// The variants, sorted and joined with `:`; empty for none.
    variants: String,
    property: String,
}

/// A top-level entry of a block: the class or declaration as written, its offset, its slots.
type Entry = (String, u32, BTreeSet<(String, String)>);

/// Every exclusive slot a class fills, followed through the classes it applies.
fn slots(index: &ClassIndex, class: &str) -> BTreeSet<(String, String)> {
    let mut found = BTreeSet::new();
    expand(index, class, &[], 0, &mut found);
    found
}

fn expand(
    index: &ClassIndex,
    class: &str,
    outer: &[String],
    depth: usize,
    found: &mut BTreeSet<(String, String)>,
) {
    let token = split(class);
    let mut variants: Vec<String> = outer.to_vec();
    variants.extend(token.variants.iter().map(|variant| variant.to_string()));

    if index.floor(token.utility).is_some() {
        if depth < MAX_DEPTH {
            for inner in index.applies(token.utility) {
                expand(index, inner, &variants, depth + 1, found);
            }
        }
        return;
    }

    let Some(brick) = classify(token.utility, &|role| index.is_role(role)) else {
        return;
    };
    let mut key = variants;
    key.sort();
    key.dedup();
    let key = key.join(":");
    for property in brick.properties.names() {
        if EXCLUSIVE.contains(&property) {
            found.insert((key.clone(), property.to_string()));
        }
    }
}

pub fn check(context: &CssContext<'_>) -> Vec<Diagnostic> {
    let text = context.text();
    let mut diagnostics = Vec::new();

    for block in &context.scan.blocks {
        let name = match block.kind {
            BlockKind::Utility { name, .. } | BlockKind::Function { name } => name,
            _ => continue,
        };

        // Every top-level entry with what it fills, in source order: `@apply` classes, and
        // declarations as arbitrary properties.
        let mut entries: Vec<Entry> = applied(block.nodes, text)
            .into_iter()
            .map(|applied| {
                (
                    applied.class.to_string(),
                    applied.offset,
                    slots(context.index, applied.class),
                )
            })
            .collect();
        for node in block.nodes {
            if let Node::Declaration(declaration) = node {
                let property = declaration.name.text(text);
                entries.push((
                    property.to_string(),
                    declaration.name.start,
                    slots(context.index, &format!("[{property}:x]")),
                ));
            }
        }
        entries.sort_by_key(|(_, offset, _)| *offset);

        let mut owners: HashMap<Slot, String> = HashMap::new();
        for (class, offset, filled) in entries {
            let mut clash: Option<(Slot, String)> = None;
            for (variants, property) in filled {
                let slot = Slot { variants, property };
                match owners.get(&slot) {
                    Some(owner) => {
                        if clash.is_none() {
                            clash = Some((slot, owner.clone()));
                        }
                    }
                    None => {
                        owners.insert(slot, class.clone());
                    }
                }
            }
            if let Some((slot, owner)) = clash {
                let under = if slot.variants.is_empty() {
                    String::new()
                } else {
                    format!(" under {}:", slot.variants)
                };
                diagnostics.push(context.report(
                    offset,
                    RULE,
                    format!(
                        "{class} sets {}{under}, which {owner} already sets in {name}: the order of \
                         @apply would decide which wins",
                        slot.property
                    ),
                ));
            }
        }
    }

    diagnostics
}

#[cfg(test)]
mod tests;
