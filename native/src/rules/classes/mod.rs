//! The functional-class rules: eight over the configured CSS, one over markup.
//!
//! The CSS rules run outside the oxc registry — their input is a scanned stylesheet, not a
//! `Program` — through [`run_css`]; the markup rule is an ordinary registry rule that reads the
//! class index from the config.

pub mod colour;
pub mod component;
pub mod css;
pub mod reference;
pub mod require_function_class;

#[cfg(test)]
pub mod testing;

use crate::config::{ClassesConfig, Config, Severity};
use crate::rules::classes::css::bricks::{classify, split, Brick, Token};
use crate::rules::classes::css::index::ClassIndex;
use crate::rules::classes::css::parse::{AtRule, Node, Sheet};
use crate::rules::classes::css::scan::{Floor, Scan};
use crate::rules::report;
use crate::{Diagnostic, Source};

/// What a CSS rule reads: the stylesheet, its placement, and the project around it.
pub struct CssContext<'a> {
    pub source: &'a Source<'a>,
    pub sheet: &'a Sheet,
    pub scan: &'a Scan<'a>,
    pub index: &'a ClassIndex,
    pub classes: &'a ClassesConfig,
    /// The stylesheet's path relative to the config root.
    pub file: &'a str,
}

impl CssContext<'_> {
    /// The stylesheet's text.
    pub fn text(&self) -> &str {
        self.source.text
    }

    /// A diagnostic at a byte offset of this stylesheet.
    pub fn report(&self, offset: u32, rule: &str, message: String) -> Diagnostic {
        report(self.source, offset, rule, message)
    }
}

type CssCheck = fn(&CssContext<'_>) -> Vec<Diagnostic>;

/// Every CSS rule, by the id it reports under.
pub const CSS_REGISTRY: [(&str, CssCheck); 8] = [
    (
        colour::valid_palette_token::RULE,
        colour::valid_palette_token::check,
    ),
    (
        colour::valid_color_role::RULE,
        colour::valid_color_role::check,
    ),
    (
        colour::valid_tone_class::RULE,
        colour::valid_tone_class::check,
    ),
    (
        component::valid_trait_class::RULE,
        component::valid_trait_class::check,
    ),
    (
        component::valid_pattern_class::RULE,
        component::valid_pattern_class::check,
    ),
    (
        component::valid_function_class::RULE,
        component::valid_function_class::check,
    ),
    (
        reference::no_unknown_class_reference::RULE,
        reference::no_unknown_class_reference::check,
    ),
    (
        reference::no_duplicate_class::RULE,
        reference::no_duplicate_class::check,
    ),
];

/// Runs the CSS rules the config leaves on over one stylesheet.
pub fn run_css(context: &CssContext<'_>, config: &Config) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();

    for (rule, check) in CSS_REGISTRY {
        let severity = config.severity(rule);
        if severity == Severity::Off {
            continue;
        }
        diagnostics.extend(check(context).into_iter().map(|mut diagnostic| {
            diagnostic.severity = severity;
            diagnostic
        }));
    }

    diagnostics
}

/// One class named by an `@apply`.
pub struct Applied<'a> {
    /// The class as written, variants included.
    pub class: &'a str,
    pub offset: u32,
    pub token: Token<'a>,
}

impl Applied<'_> {
    /// Whether the class carries the `dark:` variant, which the methodology forbids.
    pub fn is_dark(&self) -> bool {
        self.token.variants.contains(&"dark")
    }
}

/// Whether a node is an `@apply`.
pub fn is_apply(node: &Node, text: &str) -> bool {
    matches!(node, Node::At(rule) if rule.name.text(text).eq_ignore_ascii_case("apply"))
}

/// The classes one `@apply` names, with their offsets. `!important` is not a class.
pub fn apply_classes<'a>(rule: &AtRule, text: &'a str) -> Vec<Applied<'a>> {
    let prelude = rule.prelude.text(text);
    let base = rule.prelude.start;
    let mut classes = Vec::new();
    let mut cursor = 0usize;

    for class in prelude.split_ascii_whitespace() {
        let start = cursor + prelude[cursor..].find(class).unwrap_or(0);
        cursor = start + class.len();
        if class == "!important" {
            continue;
        }
        classes.push(Applied {
            class,
            offset: base + start as u32,
            token: split(class),
        });
    }

    classes
}

/// The classes the direct `@apply` children of a block name.
pub fn applied<'a>(nodes: &'a [Node], text: &'a str) -> Vec<Applied<'a>> {
    nodes
        .iter()
        .filter_map(|node| match node {
            Node::At(rule) if rule.name.text(text).eq_ignore_ascii_case("apply") => Some(rule),
            _ => None,
        })
        .flat_map(|rule| apply_classes(rule, text))
        .collect()
}

/// What a class in `@apply` resolves to.
pub enum Resolved<'a> {
    /// A class the configured CSS defines, on its floor.
    Class(Floor),
    /// A Tailwind utility.
    Brick(Brick<'a>),
    /// Neither.
    Unknown,
}

/// Resolves a bare utility: the project's own classes first, then the Brick table.
pub fn resolve<'a>(index: &ClassIndex, utility: &'a str) -> Resolved<'a> {
    if let Some(floor) = index.floor(utility) {
        return Resolved::Class(floor);
    }

    match classify(utility, &|name| index.is_role(name)) {
        Some(brick) => Resolved::Brick(brick),
        None => Resolved::Unknown,
    }
}

/// The offset of a node, for reporting it.
pub fn node_offset(node: &Node) -> u32 {
    match node {
        Node::At(rule) => rule.at,
        Node::Rule(rule) => rule.selector.start,
        Node::Declaration(declaration) => declaration.name.start,
    }
}

/// The message for `dark:`, shared by every floor rule.
pub fn dark_message(class: &str) -> String {
    format!(
        "{class}: the dark: variant is not allowed; themes switch by overriding Roles in a theme \
         selector block"
    )
}

/// `a, b and c` for messages.
pub fn listing(items: &[&str]) -> String {
    match items {
        [] => String::new(),
        [one] => (*one).to_string(),
        [init @ .., last] => format!("{} and {last}", init.join(", ")),
    }
}
