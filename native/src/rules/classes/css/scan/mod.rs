//! Places the blocks of a scanned stylesheet on the methodology's floors, once per file, so every
//! rule reads the same placement instead of re-deriving it.

use super::parse::{Node, Sheet};
use crate::config::ClassesConfig;

/// The floors of the methodology. `Unplaced` is an `@utility` whose name puts it on none.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Floor {
    Palette,
    Role,
    Tone,
    Trait,
    Pattern,
    Function,
    Unplaced,
}

impl Floor {
    /// The floor's name as messages spell it.
    pub fn label(self) -> &'static str {
        match self {
            Floor::Palette => "Palette token",
            Floor::Role => "Role",
            Floor::Tone => "Tone",
            Floor::Trait => "Trait",
            Floor::Pattern => "Pattern",
            Floor::Function => "Function",
            Floor::Unplaced => "utility on no floor",
        }
    }
}

/// What a block is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockKind<'s> {
    /// `@theme { … }`.
    Theme,
    /// A rule whose selector is made only of configured theme selectors: `:root`,
    /// `[data-theme="dark"]`.
    ThemeSelector,
    /// `@utility name { … }`.
    Utility { name: &'s str, floor: Floor },
    /// `.name { … }` in `@layer components`.
    Function { name: &'s str },
    /// `.name[attr] { … }` in `@layer components`, or `&[attr] { … }` nested in a Function.
    State {
        name: &'s str,
        /// The one attribute selector, brackets included: `[data-status="paid"]`.
        attribute: &'s str,
    },
    /// A rule with a class selector outside `@layer components`.
    ClassOutside { selector: &'s str },
}

/// One placed block: what it is, where to report it, and its direct children.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Block<'s> {
    pub kind: BlockKind<'s>,
    pub at: u32,
    pub nodes: &'s [Node],
}

/// Something in `@layer components` that is not a Function rule.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stray {
    pub at: u32,
    pub message: &'static str,
}

/// A file's placement.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Scan<'s> {
    pub blocks: Vec<Block<'s>>,
    pub strays: Vec<Stray>,
}

/// At-rules whose blocks hold the same statements their parent would: walked through.
const TRANSPARENT: [&str; 6] = [
    "layer",
    "media",
    "supports",
    "container",
    "scope",
    "starting-style",
];

/// Places every block of a sheet.
pub fn scan<'s>(sheet: &'s Sheet, text: &'s str, config: &ClassesConfig) -> Scan<'s> {
    let mut scan = Scan::default();
    walk(&sheet.nodes, text, config, &mut scan);
    scan
}

fn walk<'s>(nodes: &'s [Node], text: &'s str, config: &ClassesConfig, scan: &mut Scan<'s>) {
    for node in nodes {
        match node {
            Node::At(rule) => {
                let Some(block) = &rule.block else {
                    continue;
                };
                let name = rule.name.text(text);

                if name.eq_ignore_ascii_case("theme") {
                    scan.blocks.push(Block {
                        kind: BlockKind::Theme,
                        at: rule.at,
                        nodes: block,
                    });
                } else if name.eq_ignore_ascii_case("utility") {
                    let utility = rule.prelude.text(text);
                    scan.blocks.push(Block {
                        kind: BlockKind::Utility {
                            name: utility,
                            floor: utility_floor(utility, config),
                        },
                        at: rule.prelude.start,
                        nodes: block,
                    });
                } else if name.eq_ignore_ascii_case("layer")
                    && rule.prelude.text(text).trim() == "components"
                {
                    components(block, text, scan);
                } else if TRANSPARENT
                    .iter()
                    .any(|transparent| name.eq_ignore_ascii_case(transparent))
                {
                    walk(block, text, config, scan);
                }
            }
            Node::Rule(rule) => {
                let selector = rule.selector.text(text);
                if is_theme_selector(selector, config) {
                    scan.blocks.push(Block {
                        kind: BlockKind::ThemeSelector,
                        at: rule.selector.start,
                        nodes: &rule.body,
                    });
                } else if has_class_selector(selector) {
                    scan.blocks.push(Block {
                        kind: BlockKind::ClassOutside { selector },
                        at: rule.selector.start,
                        nodes: &rule.body,
                    });
                }
            }
            Node::Declaration(_) => {}
        }
    }
}

const NOT_A_FUNCTION_RULE: &str =
    "@layer components holds only Function rules: .name { @apply … } and their state blocks";
const BAD_SELECTOR: &str =
    "a Function selector is one class, optionally with one attribute: .name or .name[data-state=\"x\"]";
const BAD_NESTED: &str =
    "a Function nests only state blocks, written &[attribute] { @apply tone-… }";

fn components<'s>(nodes: &'s [Node], text: &'s str, scan: &mut Scan<'s>) {
    for node in nodes {
        let Node::Rule(rule) = node else {
            let at = match node {
                Node::At(rule) => rule.at,
                Node::Declaration(declaration) => declaration.name.start,
                Node::Rule(_) => unreachable!("matched above"),
            };
            scan.strays.push(Stray {
                at,
                message: NOT_A_FUNCTION_RULE,
            });
            continue;
        };

        match function_selector(rule.selector.text(text)) {
            Some((name, None)) => {
                scan.blocks.push(Block {
                    kind: BlockKind::Function { name },
                    at: rule.selector.start,
                    nodes: &rule.body,
                });
                for child in &rule.body {
                    let Node::Rule(nested) = child else {
                        continue;
                    };
                    let selector = nested.selector.text(text);
                    let attribute = selector
                        .strip_prefix('&')
                        .filter(|rest| is_one_attribute(rest));
                    if let Some(attribute) = attribute {
                        scan.blocks.push(Block {
                            kind: BlockKind::State { name, attribute },
                            at: nested.selector.start,
                            nodes: &nested.body,
                        });
                    } else {
                        scan.strays.push(Stray {
                            at: nested.selector.start,
                            message: BAD_NESTED,
                        });
                    }
                }
            }
            Some((name, Some(attribute))) => {
                scan.blocks.push(Block {
                    kind: BlockKind::State { name, attribute },
                    at: rule.selector.start,
                    nodes: &rule.body,
                });
            }
            None => scan.strays.push(Stray {
                at: rule.selector.start,
                message: BAD_SELECTOR,
            }),
        }
    }
}

/// The floor an `@utility` name puts it on.
pub fn utility_floor(name: &str, config: &ClassesConfig) -> Floor {
    if name.starts_with("tone-") {
        Floor::Tone
    } else if name.starts_with("pattern-") {
        Floor::Pattern
    } else if name
        .split_once('-')
        .is_some_and(|(kind, rest)| !rest.is_empty() && config.trait_kind(kind).is_some())
    {
        Floor::Trait
    } else {
        Floor::Unplaced
    }
}

fn is_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')
}

/// `.name` → `(name, None)`; `.name[attr…]` → `(name, Some("[attr…]"))`; anything else `None`.
pub fn function_selector(selector: &str) -> Option<(&str, Option<&str>)> {
    let rest = selector.strip_prefix('.')?;
    let end = rest
        .bytes()
        .position(|byte| !is_name_byte(byte))
        .unwrap_or(rest.len());
    if end == 0 {
        return None;
    }
    let (name, tail) = rest.split_at(end);

    if tail.is_empty() {
        Some((name, None))
    } else if is_one_attribute(tail) {
        Some((name, Some(tail)))
    } else {
        None
    }
}

/// An attribute selector's name and the value it requires: `[data-status="paid"]` is
/// `("data-status", Some("paid"))`; a presence test or an operator other than `=` is `None`, since
/// it matches values this reading cannot list.
pub fn attribute_requirement(attribute: &str) -> Option<(&str, Option<&str>)> {
    let inner = attribute.strip_prefix('[')?.strip_suffix(']')?.trim();
    let Some((name, value)) = inner.split_once('=') else {
        return Some((inner, None));
    };
    if name.ends_with(['~', '|', '^', '$', '*']) {
        return Some((
            name.trim_end_matches(['~', '|', '^', '$', '*']).trim(),
            None,
        ));
    }
    let value = value.trim();
    // A case-sensitivity flag after the value (`"x" i`) widens what matches: treat as unknown.
    let unquoted = value
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .or_else(|| {
            value
                .strip_prefix('\'')
                .and_then(|rest| rest.strip_suffix('\''))
        })
        .or_else(|| (!value.contains([' ', '"', '\''])).then_some(value));

    Some((name.trim(), unquoted))
}

/// Whether the text is exactly one attribute selector, `[…]`, with quoted values allowed.
fn is_one_attribute(text: &str) -> bool {
    let bytes = text.as_bytes();
    if bytes.first() != Some(&b'[') || bytes.last() != Some(&b']') || bytes.len() < 3 {
        return false;
    }

    let mut quote: Option<u8> = None;
    for (index, &byte) in bytes.iter().enumerate().skip(1) {
        match quote {
            Some(open) if byte == open => quote = None,
            Some(_) => {}
            None => match byte {
                b'"' | b'\'' => quote = Some(byte),
                b'[' => return false,
                b']' => return index == bytes.len() - 1,
                _ => {}
            },
        }
    }

    false
}

/// Whether every comma-separated selector is a compound of configured theme selectors only:
/// `:root`, `[data-theme="dark"]`, `:root[data-theme="dark"]`, `.dark`.
pub fn is_theme_selector(selector: &str, config: &ClassesConfig) -> bool {
    selector
        .split(',')
        .all(|part| is_theme_compound(part.trim(), config))
}

fn is_theme_compound(compound: &str, config: &ClassesConfig) -> bool {
    let bytes = compound.as_bytes();
    if bytes.is_empty() {
        return false;
    }

    let mut index = 0usize;
    while index < bytes.len() {
        match bytes[index] {
            b':' | b'.' => {
                let start = index;
                index += 1;
                while index < bytes.len() && is_name_byte(bytes[index]) {
                    index += 1;
                }
                let piece = &compound[start..index];
                if !config.theme_selectors.iter().any(|entry| entry == piece) {
                    return false;
                }
            }
            b'[' => {
                let Some(close) = compound[index..].find(']') else {
                    return false;
                };
                let piece = &compound[index..index + close + 1];
                let name_end = piece[1..]
                    .bytes()
                    .position(|byte| !is_name_byte(byte))
                    .map_or(piece.len() - 1, |position| position + 1);
                let attribute = format!("[{}]", &piece[1..name_end]);
                if !config.theme_selectors.contains(&attribute) {
                    return false;
                }
                index += close + 1;
            }
            _ => return false,
        }
    }

    true
}

/// Whether a selector selects by class anywhere: a `.` followed by a name, outside attribute
/// brackets and strings.
pub fn has_class_selector(selector: &str) -> bool {
    let bytes = selector.as_bytes();
    let mut depth = 0usize;
    let mut quote: Option<u8> = None;

    for (index, &byte) in bytes.iter().enumerate() {
        if let Some(open) = quote {
            if byte == open {
                quote = None;
            }
            continue;
        }
        match byte {
            b'"' | b'\'' => quote = Some(byte),
            b'[' => depth += 1,
            b']' => depth = depth.saturating_sub(1),
            b'.' if depth == 0
                && bytes.get(index + 1).is_some_and(|next| {
                    next.is_ascii_alphabetic() || matches!(next, b'-' | b'_')
                }) =>
            {
                return true;
            }
            _ => {}
        }
    }

    false
}

#[cfg(test)]
mod tests;
