//! The Brick table: exact utilities and prefixes, and how each prefix reads its value.

use std::collections::HashMap;
use std::sync::OnceLock;

/// How a prefix turns its value into properties.
#[derive(Debug, Clone, Copy)]
pub(super) enum Handler {
    /// Any value sets these properties.
    Props(&'static [&'static str]),
    /// Only colours: the value is a Role token, keyword or arbitrary colour.
    Colour(&'static str),
    Text,
    Border {
        width: &'static [&'static str],
        style: bool,
    },
    Divide,
    Outline,
    Ring,
    RingOffset,
    Shadow {
        size: &'static [&'static str],
        colour: &'static str,
    },
    Decoration,
    Background,
    Stroke,
    Flex,
    Font,
    Object,
    Content,
    Gradient,
}

pub(super) struct Tables {
    pub(super) exact: HashMap<&'static str, &'static [&'static str]>,
    pub(super) prefixes: HashMap<&'static str, Handler>,
}

const DISPLAY: &[&str] = &["display"];
const POSITION: &[&str] = &["position"];
const VISIBILITY: &[&str] = &["visibility"];
const TRANSFORM_CASE: &[&str] = &["text-transform"];
const FONT_STYLE: &[&str] = &["font-style"];
const DECORATION_LINE: &[&str] = &["text-decoration-line"];
const SMOOTHING: &[&str] = &["-webkit-font-smoothing"];
const NUMERIC: &[&str] = &["font-variant-numeric"];
const BORDER_RADIUS: &[&str] = &["border-radius"];
const BOX_SHADOW: &[&str] = &["box-shadow"];
const TRANSITION: &[&str] = &[
    "transition-property",
    "transition-timing-function",
    "transition-duration",
];
const FILTER: &[&str] = &["filter"];
const BACKDROP: &[&str] = &["backdrop-filter"];
const PADDING: &[&str] = &["padding"];
const MARGIN: &[&str] = &["margin"];
const INSET: &[&str] = &["inset"];

pub(super) fn tables() -> &'static Tables {
    static TABLES: OnceLock<Tables> = OnceLock::new();

    TABLES.get_or_init(|| {
        let exact: HashMap<&'static str, &'static [&'static str]> = [
            entry("block", DISPLAY),
            entry("inline-block", DISPLAY),
            entry("inline", DISPLAY),
            entry("flex", DISPLAY),
            entry("inline-flex", DISPLAY),
            entry("grid", DISPLAY),
            entry("inline-grid", DISPLAY),
            entry("contents", DISPLAY),
            entry("flow-root", DISPLAY),
            entry("list-item", DISPLAY),
            entry("hidden", DISPLAY),
            entry("table", DISPLAY),
            entry("table-row", DISPLAY),
            entry("table-cell", DISPLAY),
            entry("static", POSITION),
            entry("fixed", POSITION),
            entry("absolute", POSITION),
            entry("relative", POSITION),
            entry("sticky", POSITION),
            entry("visible", VISIBILITY),
            entry("invisible", VISIBILITY),
            entry("collapse", VISIBILITY),
            entry("isolate", &["isolation"]),
            entry("uppercase", TRANSFORM_CASE),
            entry("lowercase", TRANSFORM_CASE),
            entry("capitalize", TRANSFORM_CASE),
            entry("normal-case", TRANSFORM_CASE),
            entry("italic", FONT_STYLE),
            entry("not-italic", FONT_STYLE),
            entry("underline", DECORATION_LINE),
            entry("overline", DECORATION_LINE),
            entry("line-through", DECORATION_LINE),
            entry("no-underline", DECORATION_LINE),
            entry("antialiased", SMOOTHING),
            entry("subpixel-antialiased", SMOOTHING),
            entry("ordinal", NUMERIC),
            entry("slashed-zero", NUMERIC),
            entry("lining-nums", NUMERIC),
            entry("oldstyle-nums", NUMERIC),
            entry("proportional-nums", NUMERIC),
            entry("tabular-nums", NUMERIC),
            entry("normal-nums", NUMERIC),
            entry("diagonal-fractions", NUMERIC),
            entry("stacked-fractions", NUMERIC),
            // Several kinds at once on purpose: a Trait that wants these spells them out.
            entry("truncate", &["overflow", "text-overflow", "white-space"]),
            entry("sr-only", &["position", "clip"]),
            entry("not-sr-only", &["position", "clip"]),
            entry("container", &["width", "max-width"]),
            entry("box-border", &["box-sizing"]),
            entry("box-content", &["box-sizing"]),
            entry("border", &["border-width"]),
            entry("border-x", &["border-inline-width"]),
            entry("border-y", &["border-block-width"]),
            entry("border-t", &["border-top-width"]),
            entry("border-r", &["border-right-width"]),
            entry("border-b", &["border-bottom-width"]),
            entry("border-l", &["border-left-width"]),
            entry("border-s", &["border-inline-start-width"]),
            entry("border-e", &["border-inline-end-width"]),
            entry("border-collapse", &["border-collapse"]),
            entry("border-separate", &["border-collapse"]),
            entry("divide-x", &["border-inline-width"]),
            entry("divide-y", &["border-block-width"]),
            entry("rounded", BORDER_RADIUS),
            entry("shadow", BOX_SHADOW),
            entry("ring", &["ring-width"]),
            entry("outline", &["outline-style", "outline-width"]),
            entry("transition", TRANSITION),
            entry("transform", &["transform"]),
            entry("grow", &["flex-grow"]),
            entry("shrink", &["flex-shrink"]),
            entry("grayscale", FILTER),
            entry("invert", FILTER),
            entry("sepia", FILTER),
            entry("blur", FILTER),
            entry("resize", &["resize"]),
        ]
        .into_iter()
        .collect();

        let rounded: [&'static str; 15] = [
            "rounded",
            "rounded-t",
            "rounded-r",
            "rounded-b",
            "rounded-l",
            "rounded-tl",
            "rounded-tr",
            "rounded-br",
            "rounded-bl",
            "rounded-s",
            "rounded-e",
            "rounded-ss",
            "rounded-se",
            "rounded-ee",
            "rounded-es",
        ];

        let mut prefixes: HashMap<&'static str, Handler> = [
            ("p", Handler::Props(PADDING)),
            ("px", Handler::Props(&["padding-inline"])),
            ("py", Handler::Props(&["padding-block"])),
            ("pt", Handler::Props(&["padding-top"])),
            ("pr", Handler::Props(&["padding-right"])),
            ("pb", Handler::Props(&["padding-bottom"])),
            ("pl", Handler::Props(&["padding-left"])),
            ("ps", Handler::Props(&["padding-inline-start"])),
            ("pe", Handler::Props(&["padding-inline-end"])),
            ("m", Handler::Props(MARGIN)),
            ("mx", Handler::Props(&["margin-inline"])),
            ("my", Handler::Props(&["margin-block"])),
            ("mt", Handler::Props(&["margin-top"])),
            ("mr", Handler::Props(&["margin-right"])),
            ("mb", Handler::Props(&["margin-bottom"])),
            ("ml", Handler::Props(&["margin-left"])),
            ("ms", Handler::Props(&["margin-inline-start"])),
            ("me", Handler::Props(&["margin-inline-end"])),
            ("space-x", Handler::Props(&["margin-inline-start"])),
            ("space-y", Handler::Props(&["margin-block-start"])),
            ("w", Handler::Props(&["width"])),
            ("h", Handler::Props(&["height"])),
            ("size", Handler::Props(&["width", "height"])),
            ("min-w", Handler::Props(&["min-width"])),
            ("min-h", Handler::Props(&["min-height"])),
            ("max-w", Handler::Props(&["max-width"])),
            ("max-h", Handler::Props(&["max-height"])),
            ("aspect", Handler::Props(&["aspect-ratio"])),
            ("box-decoration", Handler::Props(&["box-decoration-break"])),
            ("basis", Handler::Props(&["flex-basis"])),
            ("grow", Handler::Props(&["flex-grow"])),
            ("shrink", Handler::Props(&["flex-shrink"])),
            ("flex", Handler::Flex),
            ("order", Handler::Props(&["order"])),
            ("grid-cols", Handler::Props(&["grid-template-columns"])),
            ("grid-rows", Handler::Props(&["grid-template-rows"])),
            ("grid-flow", Handler::Props(&["grid-auto-flow"])),
            ("auto-cols", Handler::Props(&["grid-auto-columns"])),
            ("auto-rows", Handler::Props(&["grid-auto-rows"])),
            ("col", Handler::Props(&["grid-column"])),
            ("col-span", Handler::Props(&["grid-column"])),
            ("col-start", Handler::Props(&["grid-column-start"])),
            ("col-end", Handler::Props(&["grid-column-end"])),
            ("row", Handler::Props(&["grid-row"])),
            ("row-span", Handler::Props(&["grid-row"])),
            ("row-start", Handler::Props(&["grid-row-start"])),
            ("row-end", Handler::Props(&["grid-row-end"])),
            ("gap", Handler::Props(&["gap"])),
            ("gap-x", Handler::Props(&["column-gap"])),
            ("gap-y", Handler::Props(&["row-gap"])),
            ("justify", Handler::Props(&["justify-content"])),
            ("justify-items", Handler::Props(&["justify-items"])),
            ("justify-self", Handler::Props(&["justify-self"])),
            ("items", Handler::Props(&["align-items"])),
            ("content", Handler::Content),
            ("self", Handler::Props(&["align-self"])),
            ("place-content", Handler::Props(&["place-content"])),
            ("place-items", Handler::Props(&["place-items"])),
            ("place-self", Handler::Props(&["place-self"])),
            ("inset", Handler::Props(INSET)),
            ("inset-x", Handler::Props(&["inset-inline"])),
            ("inset-y", Handler::Props(&["inset-block"])),
            ("top", Handler::Props(&["top"])),
            ("right", Handler::Props(&["right"])),
            ("bottom", Handler::Props(&["bottom"])),
            ("left", Handler::Props(&["left"])),
            ("start", Handler::Props(&["inset-inline-start"])),
            ("end", Handler::Props(&["inset-inline-end"])),
            ("z", Handler::Props(&["z-index"])),
            ("overflow", Handler::Props(&["overflow"])),
            ("overflow-x", Handler::Props(&["overflow-x"])),
            ("overflow-y", Handler::Props(&["overflow-y"])),
            ("overscroll", Handler::Props(&["overscroll-behavior"])),
            ("overscroll-x", Handler::Props(&["overscroll-behavior"])),
            ("overscroll-y", Handler::Props(&["overscroll-behavior"])),
            ("float", Handler::Props(&["float"])),
            ("clear", Handler::Props(&["clear"])),
            ("isolation", Handler::Props(&["isolation"])),
            ("columns", Handler::Props(&["columns"])),
            ("object", Handler::Object),
            ("table", Handler::Props(&["table-layout"])),
            ("caption", Handler::Props(&["caption-side"])),
            ("border-spacing", Handler::Props(&["border-spacing"])),
            ("border-spacing-x", Handler::Props(&["border-spacing"])),
            ("border-spacing-y", Handler::Props(&["border-spacing"])),
            ("break-after", Handler::Props(&["break-after"])),
            ("break-before", Handler::Props(&["break-before"])),
            ("break-inside", Handler::Props(&["break-inside"])),
            ("break", Handler::Props(&["word-break", "overflow-wrap"])),
            ("font", Handler::Font),
            ("text", Handler::Text),
            ("leading", Handler::Props(&["line-height"])),
            ("tracking", Handler::Props(&["letter-spacing"])),
            ("indent", Handler::Props(&["text-indent"])),
            ("align", Handler::Props(&["vertical-align"])),
            ("whitespace", Handler::Props(&["white-space"])),
            ("hyphens", Handler::Props(&["hyphens"])),
            ("line-clamp", Handler::Props(&["-webkit-line-clamp"])),
            ("list", Handler::Props(&["list-style-type"])),
            ("list-image", Handler::Props(&["list-style-image"])),
            (
                "underline-offset",
                Handler::Props(&["text-underline-offset"]),
            ),
            ("decoration", Handler::Decoration),
            (
                "border",
                Handler::Border {
                    width: &["border-width"],
                    style: true,
                },
            ),
            (
                "border-x",
                Handler::Border {
                    width: &["border-inline-width"],
                    style: false,
                },
            ),
            (
                "border-y",
                Handler::Border {
                    width: &["border-block-width"],
                    style: false,
                },
            ),
            (
                "border-t",
                Handler::Border {
                    width: &["border-top-width"],
                    style: false,
                },
            ),
            (
                "border-r",
                Handler::Border {
                    width: &["border-right-width"],
                    style: false,
                },
            ),
            (
                "border-b",
                Handler::Border {
                    width: &["border-bottom-width"],
                    style: false,
                },
            ),
            (
                "border-l",
                Handler::Border {
                    width: &["border-left-width"],
                    style: false,
                },
            ),
            (
                "border-s",
                Handler::Border {
                    width: &["border-inline-start-width"],
                    style: false,
                },
            ),
            (
                "border-e",
                Handler::Border {
                    width: &["border-inline-end-width"],
                    style: false,
                },
            ),
            ("divide", Handler::Divide),
            ("divide-x", Handler::Props(&["border-inline-width"])),
            ("divide-y", Handler::Props(&["border-block-width"])),
            ("outline", Handler::Outline),
            ("outline-offset", Handler::Props(&["outline-offset"])),
            ("ring", Handler::Ring),
            ("ring-offset", Handler::RingOffset),
            (
                "shadow",
                Handler::Shadow {
                    size: BOX_SHADOW,
                    colour: "shadow-color",
                },
            ),
            (
                "inset-shadow",
                Handler::Shadow {
                    size: BOX_SHADOW,
                    colour: "shadow-color",
                },
            ),
            (
                "text-shadow",
                Handler::Shadow {
                    size: &["text-shadow"],
                    colour: "text-shadow-color",
                },
            ),
            ("drop-shadow", Handler::Props(FILTER)),
            ("blur", Handler::Props(FILTER)),
            ("brightness", Handler::Props(FILTER)),
            ("contrast", Handler::Props(FILTER)),
            ("grayscale", Handler::Props(FILTER)),
            ("hue-rotate", Handler::Props(FILTER)),
            ("invert", Handler::Props(FILTER)),
            ("saturate", Handler::Props(FILTER)),
            ("sepia", Handler::Props(FILTER)),
            ("backdrop-blur", Handler::Props(BACKDROP)),
            ("backdrop-brightness", Handler::Props(BACKDROP)),
            ("backdrop-contrast", Handler::Props(BACKDROP)),
            ("backdrop-grayscale", Handler::Props(BACKDROP)),
            ("backdrop-invert", Handler::Props(BACKDROP)),
            ("backdrop-opacity", Handler::Props(BACKDROP)),
            ("backdrop-saturate", Handler::Props(BACKDROP)),
            ("backdrop-sepia", Handler::Props(BACKDROP)),
            ("mix-blend", Handler::Props(&["mix-blend-mode"])),
            ("bg-blend", Handler::Props(&["background-blend-mode"])),
            ("opacity", Handler::Props(&["opacity"])),
            ("bg", Handler::Background),
            ("from", Handler::Gradient),
            ("via", Handler::Gradient),
            ("to", Handler::Gradient),
            ("fill", Handler::Colour("fill")),
            ("stroke", Handler::Stroke),
            ("caret", Handler::Colour("caret-color")),
            ("accent", Handler::Colour("accent-color")),
            ("placeholder", Handler::Colour("color")),
            ("transition", Handler::Props(&["transition-property"])),
            ("duration", Handler::Props(&["transition-duration"])),
            ("ease", Handler::Props(&["transition-timing-function"])),
            ("delay", Handler::Props(&["transition-delay"])),
            ("animate", Handler::Props(&["animation"])),
            ("transform", Handler::Props(&["transform"])),
            ("origin", Handler::Props(&["transform-origin"])),
            ("translate", Handler::Props(&["translate"])),
            ("translate-x", Handler::Props(&["translate"])),
            ("translate-y", Handler::Props(&["translate"])),
            ("translate-z", Handler::Props(&["translate"])),
            ("scale", Handler::Props(&["scale"])),
            ("scale-x", Handler::Props(&["scale"])),
            ("scale-y", Handler::Props(&["scale"])),
            ("scale-z", Handler::Props(&["scale"])),
            ("rotate", Handler::Props(&["rotate"])),
            ("rotate-x", Handler::Props(&["rotate"])),
            ("rotate-y", Handler::Props(&["rotate"])),
            ("rotate-z", Handler::Props(&["rotate"])),
            ("skew", Handler::Props(&["transform"])),
            ("skew-x", Handler::Props(&["transform"])),
            ("skew-y", Handler::Props(&["transform"])),
            ("perspective", Handler::Props(&["perspective"])),
            (
                "perspective-origin",
                Handler::Props(&["perspective-origin"]),
            ),
            ("backface", Handler::Props(&["backface-visibility"])),
            ("will-change", Handler::Props(&["will-change"])),
            ("cursor", Handler::Props(&["cursor"])),
            ("pointer-events", Handler::Props(&["pointer-events"])),
            ("select", Handler::Props(&["user-select"])),
            ("touch", Handler::Props(&["touch-action"])),
            ("resize", Handler::Props(&["resize"])),
            ("appearance", Handler::Props(&["appearance"])),
            ("scroll", Handler::Props(&["scroll-behavior"])),
            ("snap", Handler::Props(&["scroll-snap-type"])),
            ("snap-align", Handler::Props(&["scroll-snap-align"])),
            ("snap-stop", Handler::Props(&["scroll-snap-stop"])),
        ]
        .into_iter()
        .collect();

        for prefix in rounded {
            prefixes.insert(prefix, Handler::Props(BORDER_RADIUS));
        }
        for prefix in [
            "scroll-m",
            "scroll-mx",
            "scroll-my",
            "scroll-mt",
            "scroll-mr",
            "scroll-mb",
            "scroll-ml",
            "scroll-ms",
            "scroll-me",
        ] {
            prefixes.insert(prefix, Handler::Props(&["scroll-margin"]));
        }
        for prefix in [
            "scroll-p",
            "scroll-px",
            "scroll-py",
            "scroll-pt",
            "scroll-pr",
            "scroll-pb",
            "scroll-pl",
            "scroll-ps",
            "scroll-pe",
        ] {
            prefixes.insert(prefix, Handler::Props(&["scroll-padding"]));
        }

        Tables { exact, prefixes }
    })
}

/// One exact-table row; a function so each slice coerces to `&[&str]` on its own.
fn entry(
    name: &'static str,
    names: &'static [&'static str],
) -> (&'static str, &'static [&'static str]) {
    (name, names)
}
