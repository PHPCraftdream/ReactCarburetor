//! The Brick classifier: which CSS properties a Tailwind v4 utility sets, and whether it paints a
//! colour.
//!
//! The floors above Bricks are judged by what their Bricks set, so this table is the vocabulary
//! every CSS rule speaks. It is a static table, looked up by the utility's dash-separated
//! prefixes from the longest down — a hash lookup per segment, no regex on the hot path. A
//! utility the table does not know is `None`; the reference rule reports it, so a typo or a
//! utility newer than this table is visible rather than silently passed.
//!
//! Property names are canonical, not exhaustive: every `rounded-*` reports `border-radius`, every
//! border side reports its width and `border-color`. Trait kinds own property patterns, and the
//! canonical names are what those patterns are written against.

mod table;
mod values;
mod vocabulary;

use table::tables;
use values::{arbitrary_colour, fixed, resolve};
pub use vocabulary::KNOWN_PROPERTIES;

/// The colour a colour Brick paints with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Colour<'a> {
    /// A Role token: `accent-fill` in `bg-accent-fill`.
    Role(&'a str),
    /// `transparent`, `current`, `inherit`, `none`, `auto`: no palette behind it.
    Keyword,
    /// An arbitrary colour value (`bg-[#fff]`, `text-(--palette-blue-600)`) that bypasses Roles.
    Raw,
    /// A colour prefix with a token that names no Role, e.g. a stock colour after the reset.
    Unknown(&'a str),
}

/// The CSS properties a Brick sets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Properties<'a> {
    /// Canonical property names from the table.
    Fixed(&'static [&'static str]),
    /// The one property an arbitrary-property utility names: `mask-type` in
    /// `[mask-type:luminance]`.
    Arbitrary(&'a str),
}

impl<'a> Properties<'a> {
    /// The property names, whichever form they came in.
    pub fn names(&self) -> Vec<&'a str> {
        match self {
            Properties::Fixed(names) => names.to_vec(),
            Properties::Arbitrary(name) => vec![*name],
        }
    }
}

/// A recognised utility.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Brick<'a> {
    pub properties: Properties<'a>,
    /// `Some` for a colour Brick; its properties are then colour properties.
    pub colour: Option<Colour<'a>>,
}

/// One class as written in `@apply` or markup, split into its variants and the bare utility.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Token<'a> {
    /// `hover`, `focus-visible`, `data-[state=open]`, … in source order.
    pub variants: Vec<&'a str>,
    /// The utility with variants, the `!` modifier and a leading `-` removed.
    pub utility: &'a str,
}

/// Splits `hover:focus-visible:!-mx-2` into its variants and `mx-2`. Colons inside brackets or
/// parentheses (`data-[a:b]:`, `[mask-type:luminance]`) do not split.
pub fn split(class: &str) -> Token<'_> {
    let mut variants = Vec::new();
    let mut depth = 0usize;
    let mut start = 0usize;

    for (index, byte) in class.bytes().enumerate() {
        match byte {
            b'[' | b'(' => depth += 1,
            b']' | b')' => depth = depth.saturating_sub(1),
            b':' if depth == 0 => {
                variants.push(&class[start..index]);
                start = index + 1;
            }
            _ => {}
        }
    }

    let mut utility = &class[start..];
    utility = utility.strip_prefix('!').unwrap_or(utility);
    utility = utility.strip_suffix('!').unwrap_or(utility);
    utility = utility.strip_prefix('-').unwrap_or(utility);

    Token { variants, utility }
}

/// Classifies a bare utility (see [`split`]). `is_role` answers whether a token names a Role
/// defined in the project's `@theme`.
pub fn classify<'a>(utility: &'a str, is_role: &dyn Fn(&str) -> bool) -> Option<Brick<'a>> {
    if let Some(inner) = utility
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
    {
        let (property, value) = inner.split_once(':')?;
        if property.is_empty() {
            return None;
        }
        let colour = is_colour_property(property).then(|| arbitrary_colour(value, is_role));
        return Some(Brick {
            properties: Properties::Arbitrary(property),
            colour,
        });
    }

    if let Some(names) = tables().exact.get(utility) {
        return Some(fixed(names));
    }

    let mut end = utility.len();
    while let Some(dash) = utility[..end].rfind('-') {
        let prefix = &utility[..dash];
        let value = &utility[dash + 1..];
        if let Some(handler) = tables().prefixes.get(prefix) {
            if value.is_empty() {
                return None;
            }
            return resolve(*handler, value, is_role);
        }
        end = dash;
    }

    None
}

/// Whether a CSS property paints a colour. Colour belongs to Tones, so every floor but Tone
/// refuses these.
pub fn is_colour_property(property: &str) -> bool {
    property.ends_with("-color")
        || matches!(
            property,
            "color" | "fill" | "stroke" | "background" | "gradient-color"
        )
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod vocabulary_tests;
