//! The Role floor: `--color-<family>-<slot>[-<state>]` and `--color-surface-<level>`, defined in
//! `@theme` after the stock palette is reset with `--color-*: initial`, overridden only in theme
//! selector blocks, and always `var(--palette-…)`.

use crate::rules::classes::css::names::{role, role_vocabulary};
use crate::rules::classes::css::parse::Node;
use crate::rules::classes::css::scan::BlockKind;
use crate::rules::classes::CssContext;
use crate::Diagnostic;

/// The id this rule reports under.
pub const RULE: &str = "carburetor/valid-color-role";

const PREFIX: &str = "--color-";

/// Whether a value is exactly one `var(--palette-…)`.
fn is_palette_reference(value: &str) -> bool {
    value
        .strip_prefix("var(--palette-")
        .and_then(|rest| rest.strip_suffix(')'))
        .is_some_and(|token| {
            !token.is_empty()
                && token
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        })
}

pub fn check(context: &CssContext<'_>) -> Vec<Diagnostic> {
    let text = context.text();
    let mut diagnostics = Vec::new();

    for block in &context.scan.blocks {
        let mut defines_roles = false;

        for node in block.nodes {
            let Node::Declaration(declaration) = node else {
                continue;
            };
            let name = declaration.name.text(text);
            let Some(role_name) = name.strip_prefix(PREFIX) else {
                continue;
            };
            let value = declaration.value.text(text);
            let value_message =
                || format!("a Role's value is var(--palette-…): {name} has {value}");

            match block.kind {
                BlockKind::Theme => {
                    if role_name == "*" {
                        continue;
                    }
                    defines_roles = true;
                    if role(role_name, context.classes).is_none() {
                        diagnostics.push(context.report(
                            declaration.name.start,
                            RULE,
                            format!(
                                "{name} is not a Role name: <family>-<slot>[-<state>] or \
                                 surface-<level> ({})",
                                role_vocabulary(context.classes)
                            ),
                        ));
                    }
                    if !is_palette_reference(value) {
                        diagnostics.push(context.report(
                            declaration.value.start,
                            RULE,
                            value_message(),
                        ));
                    }
                }
                BlockKind::ThemeSelector => {
                    if !context.index.is_role(role_name) {
                        diagnostics.push(context.report(
                            declaration.name.start,
                            RULE,
                            format!("{name} overrides a Role that no @theme defines"),
                        ));
                    }
                    if !is_palette_reference(value) {
                        diagnostics.push(context.report(
                            declaration.value.start,
                            RULE,
                            value_message(),
                        ));
                    }
                }
                _ => diagnostics.push(context.report(
                    declaration.name.start,
                    RULE,
                    format!(
                        "{name}: Roles are defined in @theme and overridden only in theme \
                         selector blocks"
                    ),
                )),
            }
        }

        if block.kind == BlockKind::Theme && defines_roles && !context.index.has_color_reset() {
            diagnostics.push(context.report(
                block.at,
                RULE,
                "@theme does not reset the stock palette: add --color-*: initial, so utilities \
                 like bg-blue-600 do not exist and every colour goes through a Role"
                    .to_string(),
            ));
        }
    }

    diagnostics
}

#[cfg(test)]
mod tests;
