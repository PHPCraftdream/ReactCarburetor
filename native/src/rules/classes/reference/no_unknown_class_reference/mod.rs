//! Every class an `@apply` names, anywhere in the stylesheet, must be a Tailwind utility or a
//! class the configured CSS defines. A typo, a class from a deleted file, or a stock colour the
//! `--color-*: initial` reset removed would otherwise reach Tailwind's build as an error at best.

use crate::rules::classes::css::bricks::Colour;
use crate::rules::classes::css::parse::Node;
use crate::rules::classes::{apply_classes, resolve, CssContext, Resolved};
use crate::Diagnostic;

/// The id this rule reports under.
pub const RULE: &str = "carburetor/no-unknown-class-reference";

fn visit(context: &CssContext<'_>, nodes: &[Node], diagnostics: &mut Vec<Diagnostic>) {
    let text = context.text();

    for node in nodes {
        match node {
            Node::At(rule) if rule.name.text(text).eq_ignore_ascii_case("apply") => {
                for applied in apply_classes(rule, text) {
                    let class = applied.class;
                    let message = match resolve(context.index, applied.token.utility) {
                        Resolved::Unknown => Some(format!(
                            "{class} is neither a Tailwind utility nor a class the configured \
                             CSS defines"
                        )),
                        Resolved::Brick(brick) => match brick.colour {
                            Some(Colour::Unknown(token)) => Some(format!(
                                "{class} names no Role ({token}): the stock palette is reset, \
                                 so every colour comes from a Role"
                            )),
                            _ => None,
                        },
                        Resolved::Class(_) => None,
                    };
                    if let Some(message) = message {
                        diagnostics.push(context.report(applied.offset, RULE, message));
                    }
                }
            }
            Node::At(rule) => {
                if let Some(block) = &rule.block {
                    visit(context, block, diagnostics);
                }
            }
            Node::Rule(rule) => visit(context, &rule.body, diagnostics),
            Node::Declaration(_) => {}
        }
    }
}

pub fn check(context: &CssContext<'_>) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    visit(context, &context.sheet.nodes, &mut diagnostics);
    diagnostics
}

#[cfg(test)]
mod tests;
