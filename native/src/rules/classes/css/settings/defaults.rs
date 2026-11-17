//! The defaults of the `classes` section, as the methodology describes them.

pub(super) fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

pub(super) fn default_deliveries() -> Vec<(String, Vec<String>)> {
    [
        ("solid", &["fill", "on-fill"] as &[&str]),
        ("soft", &["wash", "ink"]),
        ("outline", &["edge", "ink"]),
        ("plain", &["ink"]),
        ("subtle", &["ink-subtle"]),
    ]
    .iter()
    .map(|(name, slots)| (name.to_string(), strings(slots)))
    .collect()
}

pub(super) fn default_trait_kinds() -> Vec<(String, Vec<String>)> {
    [
        (
            "shape",
            &[
                "width",
                "height",
                "min-*",
                "max-*",
                "aspect-ratio",
                "padding*",
                "margin*",
                "border-*radius",
                "border-*width",
                "border-style",
                "box-sizing",
                "stroke-width",
                "background-image",
                "background-size",
                "background-position",
                "background-repeat",
                "background-attachment",
                "background-clip",
                "background-origin",
                "object-*",
            ] as &[&str],
        ),
        (
            "type",
            &[
                "font-*",
                "line-height",
                "letter-spacing",
                "text-align",
                "text-transform",
                "text-decoration-line",
                "text-decoration-style",
                "text-decoration-thickness",
                "text-underline-offset",
                "text-overflow",
                "text-wrap",
                "text-indent",
                "white-space",
                "word-break",
                "overflow-wrap",
                "vertical-align",
                "hyphens",
                "list-style*",
                "-webkit-font-smoothing",
                "-webkit-line-clamp",
                "box-decoration-break",
                "content",
            ],
        ),
        (
            "layout",
            &[
                "display",
                "flex*",
                "order",
                "grid*",
                "gap",
                "row-gap",
                "column-gap",
                "align-content",
                "align-items",
                "align-self",
                "justify-*",
                "place-*",
                "position",
                "inset*",
                "top",
                "right",
                "bottom",
                "left",
                "z-index",
                "overflow",
                "overflow-x",
                "overflow-y",
                "overscroll-behavior",
                "float",
                "clear",
                "isolation",
                "visibility",
                "columns",
                "clip",
                "table-layout",
                "caption-side",
                "border-collapse",
                "border-spacing",
                "break-after",
                "break-before",
                "break-inside",
            ],
        ),
        (
            "motion",
            &[
                "transition*",
                "animation*",
                "transform*",
                "translate",
                "scale",
                "rotate",
                "perspective*",
                "backface-visibility",
                "will-change",
            ],
        ),
        (
            "focus",
            &[
                "outline-width",
                "outline-offset",
                "outline-style",
                "ring-width",
                "ring-offset-width",
            ],
        ),
        (
            "effect",
            &[
                "opacity",
                "box-shadow",
                "text-shadow",
                "filter",
                "backdrop-filter",
                "mix-blend-mode",
                "background-blend-mode",
            ],
        ),
        (
            "behavior",
            &[
                "cursor",
                "pointer-events",
                "user-select",
                "touch-action",
                "resize",
                "appearance",
                "scroll-*",
            ],
        ),
    ]
    .iter()
    .map(|(name, properties)| (name.to_string(), strings(properties)))
    .collect()
}
