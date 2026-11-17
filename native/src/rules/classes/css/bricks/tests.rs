use super::*;

fn is_role(name: &str) -> bool {
    matches!(
        name,
        "accent-fill" | "accent-on-fill" | "accent-edge" | "neutral-ink" | "surface-raised"
    )
}

fn brick(class: &str) -> Option<Brick<'_>> {
    classify(split(class).utility, &is_role)
}

fn properties(class: &str) -> Vec<&str> {
    brick(class)
        .unwrap_or_else(|| panic!("{class} should be a Brick"))
        .properties
        .names()
}

fn colour_of(class: &str) -> Option<Colour<'_>> {
    brick(class)
        .unwrap_or_else(|| panic!("{class} should be a Brick"))
        .colour
}

#[test]
fn split_separates_variants_modifiers_and_sign() {
    let token = split("hover:focus-visible:!-mx-2");
    assert_eq!(token.variants, vec!["hover", "focus-visible"]);
    assert_eq!(token.utility, "mx-2");

    let token = split("data-[state=open]:bg-accent-fill");
    assert_eq!(token.variants, vec!["data-[state=open]"]);
    assert_eq!(token.utility, "bg-accent-fill");

    let token = split("data-[a:b]:aria-[c:d]:px-4!");
    assert_eq!(token.variants, vec!["data-[a:b]", "aria-[c:d]"]);
    assert_eq!(token.utility, "px-4");

    let token = split("[mask-type:luminance]");
    assert!(token.variants.is_empty());
    assert_eq!(token.utility, "[mask-type:luminance]");
}

#[test]
fn spacing_and_sizing_map_to_their_longhands() {
    let table: &[(&str, &[&str])] = &[
        ("p-4", &["padding"]),
        ("px-4", &["padding-inline"]),
        ("pt-px", &["padding-top"]),
        ("-mx-2", &["margin-inline"]),
        ("ms-auto", &["margin-inline-start"]),
        ("space-x-4", &["margin-inline-start"]),
        ("w-1/2", &["width"]),
        ("h-10", &["height"]),
        ("size-4", &["width", "height"]),
        ("min-w-0", &["min-width"]),
        ("max-h-[50vh]", &["max-height"]),
        ("w-[calc(100%-1rem)]", &["width"]),
        ("rounded", &["border-radius"]),
        ("rounded-md", &["border-radius"]),
        ("rounded-tl-lg", &["border-radius"]),
        ("aspect-video", &["aspect-ratio"]),
        ("box-border", &["box-sizing"]),
    ];

    for (class, expected) in table {
        assert_eq!(properties(class), *expected, "{class}");
        assert_eq!(colour_of(class), None, "{class}");
    }
}

#[test]
fn layout_type_motion_focus_effect_and_behavior_utilities() {
    let table: &[(&str, &[&str])] = &[
        ("flex", &["display"]),
        ("hidden", &["display"]),
        ("flex-row", &["flex-direction"]),
        ("flex-wrap", &["flex-wrap"]),
        ("flex-1", &["flex"]),
        ("grow", &["flex-grow"]),
        ("shrink-0", &["flex-shrink"]),
        ("grid-cols-3", &["grid-template-columns"]),
        ("col-span-2", &["grid-column"]),
        ("gap-x-2", &["column-gap"]),
        ("justify-between", &["justify-content"]),
        ("justify-items-center", &["justify-items"]),
        ("items-center", &["align-items"]),
        ("content-center", &["align-content"]),
        ("content-none", &["content"]),
        ("self-start", &["align-self"]),
        ("absolute", &["position"]),
        ("inset-x-0", &["inset-inline"]),
        ("z-10", &["z-index"]),
        ("overflow-hidden", &["overflow"]),
        ("overflow-x-auto", &["overflow-x"]),
        ("object-cover", &["object-fit"]),
        ("object-top", &["object-position"]),
        ("font-medium", &["font-weight"]),
        ("font-mono", &["font-family"]),
        ("font-[650]", &["font-weight"]),
        ("leading-6", &["line-height"]),
        ("tracking-tight", &["letter-spacing"]),
        ("uppercase", &["text-transform"]),
        ("italic", &["font-style"]),
        ("underline", &["text-decoration-line"]),
        ("underline-offset-2", &["text-underline-offset"]),
        ("decoration-2", &["text-decoration-thickness"]),
        ("decoration-wavy", &["text-decoration-style"]),
        ("whitespace-nowrap", &["white-space"]),
        ("break-words", &["word-break", "overflow-wrap"]),
        ("line-clamp-2", &["-webkit-line-clamp"]),
        ("line-through", &["text-decoration-line"]),
        ("tabular-nums", &["font-variant-numeric"]),
        ("truncate", &["overflow", "text-overflow", "white-space"]),
        (
            "transition",
            &[
                "transition-property",
                "transition-timing-function",
                "transition-duration",
            ],
        ),
        ("transition-colors", &["transition-property"]),
        ("duration-150", &["transition-duration"]),
        ("ease-in-out", &["transition-timing-function"]),
        ("animate-spin", &["animation"]),
        ("scale-95", &["scale"]),
        ("translate-x-1/2", &["translate"]),
        ("origin-center", &["transform-origin"]),
        ("outline-2", &["outline-width"]),
        ("outline-none", &["outline-style"]),
        ("outline-offset-2", &["outline-offset"]),
        ("outline", &["outline-style", "outline-width"]),
        ("ring", &["ring-width"]),
        ("ring-2", &["ring-width"]),
        ("ring-inset", &["ring-width"]),
        ("ring-offset-2", &["ring-offset-width"]),
        ("opacity-50", &["opacity"]),
        ("shadow", &["box-shadow"]),
        ("shadow-md", &["box-shadow"]),
        ("inset-shadow-sm", &["box-shadow"]),
        ("text-shadow-lg", &["text-shadow"]),
        ("drop-shadow-md", &["filter"]),
        ("blur-sm", &["filter"]),
        ("backdrop-blur-md", &["backdrop-filter"]),
        ("cursor-pointer", &["cursor"]),
        ("pointer-events-none", &["pointer-events"]),
        ("select-none", &["user-select"]),
        ("scroll-smooth", &["scroll-behavior"]),
        ("scroll-mt-4", &["scroll-margin"]),
        ("border-spacing-2", &["border-spacing"]),
        ("stroke-2", &["stroke-width"]),
    ];

    for (class, expected) in table {
        assert_eq!(properties(class), *expected, "{class}");
        assert_eq!(colour_of(class), None, "{class}");
    }
}

#[test]
fn text_is_size_alignment_wrap_or_colour() {
    assert_eq!(properties("text-sm"), ["font-size", "line-height"]);
    assert_eq!(properties("text-sm/6"), ["font-size", "line-height"]);
    assert_eq!(properties("text-left"), ["text-align"]);
    assert_eq!(properties("text-balance"), ["text-wrap"]);
    assert_eq!(properties("text-ellipsis"), ["text-overflow"]);
    assert_eq!(properties("text-[14px]"), ["font-size"]);
    assert_eq!(colour_of("text-sm"), None);

    assert_eq!(properties("text-accent-fill"), ["color"]);
    assert_eq!(
        colour_of("text-accent-fill"),
        Some(Colour::Role("accent-fill"))
    );
    assert_eq!(colour_of("text-red-500"), Some(Colour::Unknown("red-500")));
    assert_eq!(colour_of("text-[#fff]"), Some(Colour::Raw));
    assert_eq!(colour_of("text-[color:var(--x)]"), Some(Colour::Raw));
    assert_eq!(colour_of("text-current"), Some(Colour::Keyword));
}

#[test]
fn borders_outlines_rings_and_shadows_tell_width_style_from_colour() {
    assert_eq!(properties("border"), ["border-width"]);
    assert_eq!(properties("border-2"), ["border-width"]);
    assert_eq!(properties("border-t-[3px]"), ["border-top-width"]);
    assert_eq!(properties("border-x"), ["border-inline-width"]);
    assert_eq!(properties("border-dashed"), ["border-style"]);
    assert_eq!(properties("divide-dashed"), ["border-style"]);
    assert_eq!(properties("divide-y-2"), ["border-block-width"]);

    assert_eq!(
        colour_of("border-accent-edge"),
        Some(Colour::Role("accent-edge"))
    );
    assert_eq!(
        colour_of("border-x-accent-edge"),
        Some(Colour::Role("accent-edge"))
    );
    assert_eq!(
        colour_of("divide-accent-edge"),
        Some(Colour::Role("accent-edge"))
    );
    assert_eq!(properties("border-accent-edge"), ["border-color"]);
    assert_eq!(
        colour_of("outline-accent-edge"),
        Some(Colour::Role("accent-edge"))
    );
    assert_eq!(properties("outline-accent-edge"), ["outline-color"]);
    assert_eq!(
        colour_of("ring-accent-edge"),
        Some(Colour::Role("accent-edge"))
    );
    assert_eq!(properties("ring-accent-edge"), ["ring-color"]);
    assert_eq!(
        colour_of("ring-offset-accent-edge"),
        Some(Colour::Role("accent-edge"))
    );
    assert_eq!(
        colour_of("shadow-accent-edge"),
        Some(Colour::Role("accent-edge"))
    );
    assert_eq!(properties("shadow-accent-edge"), ["shadow-color"]);
    assert_eq!(
        colour_of("decoration-accent-edge"),
        Some(Colour::Role("accent-edge"))
    );
    assert_eq!(
        colour_of("stroke-accent-edge"),
        Some(Colour::Role("accent-edge"))
    );
}

#[test]
fn backgrounds_tell_colour_from_image_size_and_position() {
    assert_eq!(
        colour_of("bg-accent-fill"),
        Some(Colour::Role("accent-fill"))
    );
    assert_eq!(properties("bg-accent-fill"), ["background-color"]);
    assert_eq!(
        colour_of("bg-accent-fill/50"),
        Some(Colour::Role("accent-fill"))
    );
    assert_eq!(
        colour_of("bg-(--color-accent-fill)"),
        Some(Colour::Role("accent-fill"))
    );
    assert_eq!(
        colour_of("bg-[var(--color-accent-fill)]"),
        Some(Colour::Role("accent-fill"))
    );
    assert_eq!(colour_of("bg-[var(--color-missing)]"), Some(Colour::Raw));
    assert_eq!(colour_of("bg-[#123456]"), Some(Colour::Raw));
    assert_eq!(colour_of("bg-[oklch(0.5_0.1_200)]/50"), Some(Colour::Raw));
    assert_eq!(colour_of("bg-transparent"), Some(Colour::Keyword));
    assert_eq!(colour_of("bg-blue-600"), Some(Colour::Unknown("blue-600")));

    assert_eq!(properties("bg-none"), ["background-image"]);
    assert_eq!(properties("bg-linear-to-r"), ["background-image"]);
    assert_eq!(properties("bg-[url(/a.png)]"), ["background-image"]);
    assert_eq!(properties("bg-cover"), ["background-size"]);
    assert_eq!(properties("bg-fixed"), ["background-attachment"]);
    assert_eq!(properties("bg-center"), ["background-position"]);
    assert_eq!(properties("bg-no-repeat"), ["background-repeat"]);
    assert_eq!(properties("bg-clip-text"), ["background-clip"]);
    assert_eq!(colour_of("bg-cover"), None);

    assert_eq!(
        colour_of("from-accent-fill"),
        Some(Colour::Role("accent-fill"))
    );
    assert_eq!(properties("from-10%"), ["background-image"]);
    assert_eq!(colour_of("fill-none"), Some(Colour::Keyword));
    assert_eq!(
        colour_of("caret-accent-fill"),
        Some(Colour::Role("accent-fill"))
    );
    assert_eq!(colour_of("accent-auto"), Some(Colour::Keyword));
}

#[test]
fn arbitrary_properties_name_their_property() {
    let mask = brick("[mask-type:luminance]").unwrap();
    assert_eq!(mask.properties, Properties::Arbitrary("mask-type"));
    assert_eq!(mask.colour, None);

    let paint = brick("[color:red]").unwrap();
    assert_eq!(paint.properties, Properties::Arbitrary("color"));
    assert_eq!(paint.colour, Some(Colour::Raw));

    let role = brick("[background-color:var(--color-accent-fill)]").unwrap();
    assert_eq!(role.colour, Some(Colour::Role("accent-fill")));

    assert_eq!(brick("[:nothing]"), None);
    assert_eq!(brick("[no-colon]"), None);
}

#[test]
fn custom_floor_names_and_garbage_are_not_bricks() {
    for class in [
        "submit-button",
        "user-card",
        "tone-accent-solid",
        "pattern-button",
        "shape-control",
        "type-label",
        "layout-stack",
        "motion-press",
        "focus-ring",
        "",
        "-",
        "p-",
        "bg",
    ] {
        assert_eq!(brick(class), None, "{class:?}");
    }
}

#[test]
fn colour_properties_are_recognised() {
    for property in [
        "color",
        "background-color",
        "border-top-color",
        "outline-color",
        "fill",
        "stroke",
        "background",
        "gradient-color",
    ] {
        assert!(is_colour_property(property), "{property}");
    }
    for property in [
        "border-width",
        "opacity",
        "stroke-width",
        "background-image",
    ] {
        assert!(!is_colour_property(property), "{property}");
    }
}
