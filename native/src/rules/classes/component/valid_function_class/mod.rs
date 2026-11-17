//! The Function floor: the only classes markup carries. Each is `.<purpose>-<element>` in
//! `@layer components`, applying at most one Pattern, any Traits and exactly one Tone; its state
//! blocks (`.name[attr]` or nested `&[attr]`) only swap the Tone. Everything that would blur the
//! floors — a custom `@utility` on no floor, a class rule elsewhere, a Brick, a declaration, a
//! variant — is reported here.

use crate::config::is_kebab;
use crate::rules::classes::css::parse::Node;
use crate::rules::classes::css::scan::{BlockKind, Floor};
use crate::rules::classes::{
    applied, dark_message, is_apply, node_offset, resolve, Applied, CssContext, Resolved,
};
use crate::Diagnostic;

/// The id this rule reports under.
pub const RULE: &str = "carburetor/valid-function-class";

fn name_problem(context: &CssContext<'_>, name: &str) -> Option<String> {
    if !is_kebab(name) {
        return Some(format!("{name} is not lowercase words joined by hyphens"));
    }
    let first = name.split('-').next().unwrap_or(name);
    if !name.contains('-') {
        return Some(format!(
            "{name}: a Function name has at least two words, <purpose>-<element>"
        ));
    }
    if context.classes.is_reserved(first) {
        return Some(format!(
            "{name} starts with {first}, which names a floor (reserved: {})",
            context.classes.reserved_words().join(", ")
        ));
    }
    None
}

fn function_body(
    context: &CssContext<'_>,
    name: &str,
    at: u32,
    nodes: &[Node],
    diagnostics: &mut Vec<Diagnostic>,
) {
    let text = context.text();

    for node in nodes {
        match node {
            Node::Declaration(declaration) => diagnostics.push(context.report(
                declaration.name.start,
                RULE,
                format!(
                    "{name}: a Function holds no declarations; put {} in a Trait",
                    declaration.name.text(text)
                ),
            )),
            Node::At(_) if is_apply(node, text) => {}
            Node::At(rule) => diagnostics.push(context.report(
                rule.at,
                RULE,
                format!("{name}: a Function holds only @apply and its state blocks"),
            )),
            // Nested rules are state blocks or strays; the scan placed both.
            Node::Rule(_) => {}
        }
    }

    let mut tones: Vec<&Applied<'_>> = Vec::new();
    let mut patterns: Vec<&Applied<'_>> = Vec::new();
    let classes = applied(nodes, text);
    for applied in &classes {
        let class = applied.class;
        if applied.is_dark() {
            diagnostics.push(context.report(applied.offset, RULE, dark_message(class)));
            continue;
        }
        if !applied.token.variants.is_empty() {
            diagnostics.push(context.report(
                applied.offset,
                RULE,
                format!(
                    "{class}: variants belong inside Tones and Traits; a Function applies them \
                     as they are"
                ),
            ));
            continue;
        }

        let problem = match resolve(context.index, applied.token.utility) {
            Resolved::Unknown | Resolved::Class(Floor::Trait) => None,
            Resolved::Class(Floor::Tone) => {
                tones.push(applied);
                None
            }
            Resolved::Class(Floor::Pattern) => {
                patterns.push(applied);
                None
            }
            Resolved::Class(Floor::Function) => Some(format!(
                "{class} is a Function; a Function does not apply another one"
            )),
            Resolved::Class(floor) => Some(format!("{class} is a {}", floor.label())),
            Resolved::Brick(_) => Some(format!(
                "{class} is a Brick: a Function applies a Pattern, Traits and one Tone"
            )),
        };
        if let Some(message) = problem {
            diagnostics.push(context.report(applied.offset, RULE, message));
        }
    }

    match tones.as_slice() {
        [] => diagnostics.push(context.report(
            at,
            RULE,
            format!("{name} has no Tone: apply exactly one tone-…"),
        )),
        [_] => {}
        [_, extra @ ..] => {
            for applied in extra {
                diagnostics.push(context.report(
                    applied.offset,
                    RULE,
                    format!(
                        "{name} applies {} Tones; one per state, other states go in state blocks",
                        tones.len()
                    ),
                ));
            }
        }
    }
    if let [_, extra @ ..] = patterns.as_slice() {
        for applied in extra {
            diagnostics.push(context.report(
                applied.offset,
                RULE,
                format!("{name} applies {} Patterns; one at most", patterns.len()),
            ));
        }
    }
}

const STATE_MESSAGE: &str = "a state block only swaps the Tone: exactly one @apply tone-…";

fn state_body(
    context: &CssContext<'_>,
    name: &str,
    at: u32,
    nodes: &[Node],
    diagnostics: &mut Vec<Diagnostic>,
) {
    let text = context.text();

    if context.index.floor(name) != Some(Floor::Function) {
        diagnostics.push(context.report(
            at,
            RULE,
            format!("this state block is for .{name}, which no Function rule defines"),
        ));
    }

    for node in nodes {
        if !is_apply(node, text) {
            diagnostics.push(context.report(node_offset(node), RULE, STATE_MESSAGE.to_string()));
        }
    }

    let classes = applied(nodes, text);
    let tone = |applied: &Applied<'_>| {
        applied.token.variants.is_empty()
            && context.index.floor(applied.token.utility) == Some(Floor::Tone)
    };
    match classes.as_slice() {
        [] => diagnostics.push(context.report(at, RULE, STATE_MESSAGE.to_string())),
        [only] if tone(only) => {}
        several => {
            for applied in several {
                if !tone(applied) || several.len() > 1 {
                    diagnostics.push(context.report(
                        applied.offset,
                        RULE,
                        STATE_MESSAGE.to_string(),
                    ));
                }
            }
        }
    }
}

pub fn check(context: &CssContext<'_>) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();

    for stray in &context.scan.strays {
        diagnostics.push(context.report(stray.at, RULE, stray.message.to_string()));
    }

    for block in &context.scan.blocks {
        match block.kind {
            BlockKind::Utility {
                name,
                floor: Floor::Unplaced,
            } => diagnostics.push(context.report(
                block.at,
                RULE,
                format!(
                    "@utility {name} is on no floor: utilities are Tones (tone-…), Patterns \
                     (pattern-…) or Traits ({}-…); a Function belongs in @layer components",
                    context
                        .classes
                        .trait_kinds
                        .iter()
                        .map(|(kind, _)| kind.as_str())
                        .collect::<Vec<_>>()
                        .join("-…, ")
                ),
            )),
            BlockKind::ClassOutside { selector } => diagnostics.push(context.report(
                block.at,
                RULE,
                format!(
                    "{selector} selects a class outside @layer components, where Functions are \
                     defined"
                ),
            )),
            BlockKind::Function { name } => {
                if let Some(message) = name_problem(context, name) {
                    diagnostics.push(context.report(block.at, RULE, message));
                }
                function_body(context, name, block.at, block.nodes, &mut diagnostics);
            }
            BlockKind::State { name, .. } => {
                state_body(context, name, block.at, block.nodes, &mut diagnostics);
            }
            _ => {}
        }
    }

    diagnostics
}

#[cfg(test)]
mod tests;
