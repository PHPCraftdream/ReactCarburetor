//! How a prefix's value turns into properties or a colour.

use super::table::Handler;
use super::{Brick, Colour, Properties};

const TEXT_SIZES: &[&str] = &[
    "xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl",
];
const TEXT_ALIGN: &[&str] = &["left", "center", "right", "justify", "start", "end"];
const TEXT_WRAP: &[&str] = &["wrap", "nowrap", "balance", "pretty"];
const TEXT_OVERFLOW: &[&str] = &["ellipsis", "clip"];
const LINE_STYLES: &[&str] = &["solid", "dashed", "dotted", "double", "hidden", "none"];
const SHADOW_SIZES: &[&str] = &["2xs", "xs", "sm", "md", "lg", "xl", "2xl", "none", "inner"];
const FONT_WEIGHTS: &[&str] = &[
    "thin",
    "extralight",
    "light",
    "normal",
    "medium",
    "semibold",
    "bold",
    "extrabold",
    "black",
];
const OBJECT_FIT: &[&str] = &["contain", "cover", "fill", "none", "scale-down"];
const COLOUR_KEYWORDS: &[&str] = &[
    "transparent",
    "current",
    "currentcolor",
    "inherit",
    "none",
    "auto",
];
const BACKGROUND_SIZE: &[&str] = &["auto", "cover", "contain"];
const BACKGROUND_ATTACHMENT: &[&str] = &["fixed", "local", "scroll"];
const BACKGROUND_POSITION: &[&str] = &[
    "center",
    "top",
    "bottom",
    "left",
    "right",
    "left-top",
    "left-bottom",
    "right-top",
    "right-bottom",
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right",
];

pub(super) fn fixed(names: &'static [&'static str]) -> Brick<'static> {
    Brick {
        properties: Properties::Fixed(names),
        colour: None,
    }
}

fn colour_brick<'a>(property: &'static str, colour: Colour<'a>) -> Brick<'a> {
    let names: &'static [&'static str] = match property {
        "color" => &["color"],
        "background-color" => &["background-color"],
        "border-color" => &["border-color"],
        "outline-color" => &["outline-color"],
        "ring-color" => &["ring-color"],
        "ring-offset-color" => &["ring-offset-color"],
        "shadow-color" => &["shadow-color"],
        "text-shadow-color" => &["text-shadow-color"],
        "text-decoration-color" => &["text-decoration-color"],
        "fill" => &["fill"],
        "stroke" => &["stroke"],
        "caret-color" => &["caret-color"],
        "accent-color" => &["accent-color"],
        _ => &["gradient-color"],
    };

    Brick {
        properties: Properties::Fixed(names),
        colour: Some(colour),
    }
}

/// The token in front of an opacity modifier: `accent-fill` in `accent-fill/50`.
fn before_modifier(value: &str) -> &str {
    value.split_once('/').map_or(value, |(token, _)| token)
}

fn is_number(value: &str) -> bool {
    (value.bytes().any(|byte| byte.is_ascii_digit())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.'))
        || value == "px"
}

/// Whether an arbitrary value (`[…]` or `(…)`) holds a colour rather than a length or image.
fn arbitrary_is_colour(value: &str) -> bool {
    let inner = strip_arbitrary(value);
    let inner = inner.trim_start_matches("color:");

    inner.starts_with('#')
        || inner.starts_with("--color-")
        || inner.starts_with("--palette-")
        || inner.starts_with("var(--color-")
        || inner.starts_with("var(--palette-")
        || [
            "rgb(",
            "rgba(",
            "hsl(",
            "hsla(",
            "hwb(",
            "lab(",
            "lch(",
            "oklab(",
            "oklch(",
            "color(",
            "color-mix(",
        ]
        .iter()
        .any(|function| inner.starts_with(function))
        || value.starts_with("[color:")
        || value.starts_with("(color:")
}

/// The inside of `[…]` or `(…)`, ignoring an opacity modifier after the closing bracket.
fn strip_arbitrary(value: &str) -> &str {
    let close = match value.as_bytes().first() {
        Some(b'[') => ']',
        Some(b'(') => ')',
        _ => return value,
    };

    match value.rfind(close) {
        Some(end) if end > 0 => &value[1..end],
        _ => &value[1..],
    }
}

fn is_arbitrary(value: &str) -> bool {
    value.starts_with('[') || value.starts_with('(')
}

/// An arbitrary colour: a Role when it is exactly `var(--color-<role>)` / `(--color-<role>)`,
/// otherwise raw.
pub(super) fn arbitrary_colour<'a>(value: &'a str, is_role: &dyn Fn(&str) -> bool) -> Colour<'a> {
    let inner = strip_arbitrary(value);
    let inner = inner.strip_prefix("color:").unwrap_or(inner);
    let role = inner
        .strip_prefix("var(--color-")
        .and_then(|rest| rest.strip_suffix(')'))
        .or_else(|| inner.strip_prefix("--color-"));

    match role {
        Some(name) if is_role(name) => Colour::Role(name),
        _ => Colour::Raw,
    }
}

/// A colour value after a colour prefix.
fn colour<'a>(value: &'a str, is_role: &dyn Fn(&str) -> bool) -> Colour<'a> {
    if is_arbitrary(value) {
        return arbitrary_colour(value, is_role);
    }

    let token = before_modifier(value);
    if COLOUR_KEYWORDS.contains(&token) {
        Colour::Keyword
    } else if is_role(token) {
        Colour::Role(token)
    } else {
        Colour::Unknown(token)
    }
}

pub(super) fn resolve<'a>(
    handler: Handler,
    value: &'a str,
    is_role: &dyn Fn(&str) -> bool,
) -> Option<Brick<'a>> {
    let base = before_modifier(value);
    let paint = |property: &'static str| Some(colour_brick(property, colour(value, is_role)));

    match handler {
        Handler::Props(names) => Some(fixed(names)),
        Handler::Colour(property) => paint(property),
        Handler::Text => {
            if TEXT_SIZES.contains(&base) {
                Some(fixed(&["font-size", "line-height"]))
            } else if TEXT_ALIGN.contains(&base) {
                Some(fixed(&["text-align"]))
            } else if TEXT_WRAP.contains(&base) {
                Some(fixed(&["text-wrap"]))
            } else if TEXT_OVERFLOW.contains(&base) {
                Some(fixed(&["text-overflow"]))
            } else if is_arbitrary(value) && !arbitrary_is_colour(value) {
                Some(fixed(&["font-size"]))
            } else {
                paint("color")
            }
        }
        Handler::Border { width, style } => {
            if is_number(value) || (is_arbitrary(value) && !arbitrary_is_colour(value)) {
                Some(fixed(width))
            } else if style && LINE_STYLES.contains(&value) {
                Some(fixed(&["border-style"]))
            } else {
                paint("border-color")
            }
        }
        Handler::Divide => {
            if LINE_STYLES.contains(&value) {
                Some(fixed(&["border-style"]))
            } else {
                paint("border-color")
            }
        }
        Handler::Outline => {
            if is_number(value) || (is_arbitrary(value) && !arbitrary_is_colour(value)) {
                Some(fixed(&["outline-width"]))
            } else if LINE_STYLES.contains(&value) {
                Some(fixed(&["outline-style"]))
            } else {
                paint("outline-color")
            }
        }
        Handler::Ring => {
            if is_number(value)
                || value == "inset"
                || (is_arbitrary(value) && !arbitrary_is_colour(value))
            {
                Some(fixed(&["ring-width"]))
            } else {
                paint("ring-color")
            }
        }
        Handler::RingOffset => {
            if is_number(value) || (is_arbitrary(value) && !arbitrary_is_colour(value)) {
                Some(fixed(&["ring-offset-width"]))
            } else {
                paint("ring-offset-color")
            }
        }
        Handler::Shadow { size, colour } => {
            if SHADOW_SIZES.contains(&base) || (is_arbitrary(value) && !arbitrary_is_colour(value))
            {
                Some(fixed(size))
            } else {
                paint(colour)
            }
        }
        Handler::Decoration => {
            if is_number(value)
                || matches!(value, "auto" | "from-font")
                || (is_arbitrary(value) && !arbitrary_is_colour(value))
            {
                Some(fixed(&["text-decoration-thickness"]))
            } else if matches!(value, "solid" | "double" | "dotted" | "dashed" | "wavy") {
                Some(fixed(&["text-decoration-style"]))
            } else if matches!(value, "clone" | "slice") {
                Some(fixed(&["box-decoration-break"]))
            } else {
                paint("text-decoration-color")
            }
        }
        Handler::Background => {
            if value == "none"
                || ["linear-", "radial", "conic", "gradient-"]
                    .iter()
                    .any(|start| value.starts_with(start))
            {
                Some(fixed(&["background-image"]))
            } else if BACKGROUND_SIZE.contains(&value) || value.starts_with("size-") {
                Some(fixed(&["background-size"]))
            } else if BACKGROUND_ATTACHMENT.contains(&value) {
                Some(fixed(&["background-attachment"]))
            } else if BACKGROUND_POSITION.contains(&value) || value.starts_with("position-") {
                Some(fixed(&["background-position"]))
            } else if value.starts_with("repeat") || value == "no-repeat" {
                Some(fixed(&["background-repeat"]))
            } else if value.starts_with("clip-") {
                Some(fixed(&["background-clip"]))
            } else if value.starts_with("origin-") {
                Some(fixed(&["background-origin"]))
            } else if is_arbitrary(value) && !arbitrary_is_colour(value) {
                Some(fixed(&["background-image"]))
            } else {
                paint("background-color")
            }
        }
        Handler::Stroke => {
            if is_number(value) {
                Some(fixed(&["stroke-width"]))
            } else {
                paint("stroke")
            }
        }
        Handler::Flex => match value {
            "row" | "row-reverse" | "col" | "col-reverse" => Some(fixed(&["flex-direction"])),
            "wrap" | "wrap-reverse" | "nowrap" => Some(fixed(&["flex-wrap"])),
            _ => Some(fixed(&["flex"])),
        },
        Handler::Font => {
            let numeric = strip_arbitrary(value)
                .bytes()
                .all(|byte| byte.is_ascii_digit());
            if FONT_WEIGHTS.contains(&value) || (is_arbitrary(value) && numeric) {
                Some(fixed(&["font-weight"]))
            } else {
                Some(fixed(&["font-family"]))
            }
        }
        Handler::Object => {
            if OBJECT_FIT.contains(&value) {
                Some(fixed(&["object-fit"]))
            } else {
                Some(fixed(&["object-position"]))
            }
        }
        Handler::Content => {
            if value == "none" || is_arbitrary(value) {
                Some(fixed(&["content"]))
            } else {
                Some(fixed(&["align-content"]))
            }
        }
        Handler::Gradient => {
            if value.ends_with('%') {
                Some(fixed(&["background-image"]))
            } else {
                paint("gradient-color")
            }
        }
    }
}
