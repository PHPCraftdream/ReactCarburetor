//! The Palette floor: raw colours, named `--palette-<hue>[-<step>]`, defined only in a theme
//! selector block (`:root`, `[data-theme]`) so Tailwind generates no utilities for them, holding
//! literal colours, and referenced only by Roles.

use std::collections::HashSet;

use crate::config::is_kebab;
use crate::rules::classes::css::parse::Node;
use crate::rules::classes::css::scan::BlockKind;
use crate::rules::classes::CssContext;
use crate::Diagnostic;

/// The id this rule reports under.
pub const RULE: &str = "carburetor/valid-palette-token";

const PREFIX: &str = "--palette-";
const REFERENCE: &str = "var(--palette-";

/// The Palette token names a value references through `var(--palette-…)`, with their offsets in
/// the value.
fn references(value: &str) -> Vec<(usize, &str)> {
    value
        .match_indices(REFERENCE)
        .map(|(index, _)| {
            let start = index + REFERENCE.len();
            let end = value[start..]
                .find(|character: char| {
                    !(character.is_ascii_alphanumeric() || character == '-' || character == '_')
                })
                .map_or(value.len(), |position| start + position);
            (index, &value[start..end])
        })
        .collect()
}

/// Every declaration in a node list, at any depth.
fn declarations<'a>(
    nodes: &'a [Node],
    out: &mut Vec<&'a crate::rules::classes::css::parse::Declaration>,
) {
    for node in nodes {
        match node {
            Node::Declaration(declaration) => out.push(declaration),
            Node::Rule(rule) => declarations(&rule.body, out),
            Node::At(rule) => {
                if let Some(block) = &rule.block {
                    declarations(block, out);
                }
            }
        }
    }
}

pub fn check(context: &CssContext<'_>) -> Vec<Diagnostic> {
    let text = context.text();
    let mut diagnostics = Vec::new();
    // Declarations that define or override a Role: the only ones that may name the Palette.
    let mut role_definitions: HashSet<u32> = HashSet::new();

    for block in &context.scan.blocks {
        for node in block.nodes {
            let Node::Declaration(declaration) = node else {
                continue;
            };
            let name = declaration.name.text(text);
            let value = declaration.value.text(text);

            if name.starts_with("--color-")
                && matches!(block.kind, BlockKind::Theme | BlockKind::ThemeSelector)
            {
                role_definitions.insert(declaration.name.start);
            }

            let Some(token) = name.strip_prefix(PREFIX) else {
                continue;
            };
            match block.kind {
                BlockKind::Theme => diagnostics.push(context.report(
                    declaration.name.start,
                    RULE,
                    format!(
                        "{name} belongs in a theme selector block (:root), not @theme: inside \
                         @theme Tailwind generates utilities for raw palette colours"
                    ),
                )),
                BlockKind::ThemeSelector => {
                    if !is_kebab(token) {
                        diagnostics.push(context.report(
                            declaration.name.start,
                            RULE,
                            format!(
                                "{name} is not --palette-<hue>[-<step>]: lowercase words joined \
                                 by hyphens"
                            ),
                        ));
                    }
                    if value.contains("var(") {
                        diagnostics.push(context.report(
                            declaration.value.start,
                            RULE,
                            format!(
                                "{name} is a Palette token: its value is a literal colour, not \
                                 var(…)"
                            ),
                        ));
                    }
                }
                _ => diagnostics.push(context.report(
                    declaration.name.start,
                    RULE,
                    format!("{name} is defined only in a theme selector block (:root …)"),
                )),
            }
        }
    }

    let mut all = Vec::new();
    declarations(&context.sheet.nodes, &mut all);
    for declaration in all {
        let value = declaration.value.text(text);
        let name = declaration.name.text(text);
        for (index, token) in references(value) {
            let offset = declaration.value.start + index as u32;
            if !role_definitions.contains(&declaration.name.start) {
                diagnostics.push(context.report(
                    offset,
                    RULE,
                    format!(
                        "only Roles reference the Palette: {name} uses var(--palette-{token}); \
                         reference a Role (var(--color-…)) instead"
                    ),
                ));
            } else if !context.index.is_palette(token) {
                diagnostics.push(context.report(
                    offset,
                    RULE,
                    format!("var(--palette-{token}) names no Palette token"),
                ));
            }
        }
    }

    diagnostics
}

#[cfg(test)]
mod tests;
