use super::*;
use crate::config::Config;

fn classes() -> Config {
    Config::from_json(r#"{"classes": {"css": ["*.css"]}}"#).unwrap()
}

#[test]
fn roles_parse_family_slot_and_state() {
    let config = classes();
    let classes = config.classes().unwrap();

    assert_eq!(
        role("accent-fill", classes),
        Some(RoleName::Family {
            family: "accent",
            slot: "fill",
            state: None
        })
    );
    assert_eq!(
        role("accent-on-fill-hover", classes),
        Some(RoleName::Family {
            family: "accent",
            slot: "on-fill",
            state: Some("hover")
        })
    );
    assert_eq!(
        role("neutral-ink-subtle", classes),
        Some(RoleName::Family {
            family: "neutral",
            slot: "ink-subtle",
            state: None
        })
    );
    assert_eq!(
        role("neutral-ink-active", classes),
        Some(RoleName::Family {
            family: "neutral",
            slot: "ink",
            state: Some("active")
        })
    );
    assert_eq!(
        role("surface-raised", classes),
        Some(RoleName::Surface { level: "raised" })
    );

    for bad in [
        "accent",
        "accent-",
        "brand-fill",
        "accent-glow",
        "accent-fill-focus",
        "accent-fill-hover-active",
        "surface-floating",
        "surface",
    ] {
        assert_eq!(role(bad, classes), None, "{bad}");
    }
}

#[test]
fn tones_parse_family_and_delivery() {
    let config = classes();
    let classes = config.classes().unwrap();

    assert_eq!(
        tone("danger-outline", classes),
        Some(ToneName::Family {
            family: "danger",
            delivery: "outline"
        })
    );
    assert_eq!(
        tone("surface-overlay", classes),
        Some(ToneName::Surface { level: "overlay" })
    );
    for bad in ["danger", "danger-glossy", "brand-solid", "surface-x", ""] {
        assert_eq!(tone(bad, classes), None, "{bad}");
    }
}

#[test]
fn configured_lists_change_the_grammar() {
    let config = Config::from_json(
        r#"{"classes": {"css": ["*.css"], "families": ["brand"], "slots": ["bg", "fg"], "states": ["pressed"], "deliveries": {"filled": ["bg", "fg"]}, "surfaceLevels": ["base"]}}"#,
    )
    .unwrap();
    let classes = config.classes().unwrap();

    assert!(role("brand-fg-pressed", classes).is_some());
    assert!(role("accent-fill", classes).is_none());
    assert!(tone("brand-filled", classes).is_some());
    assert!(tone("surface-base", classes).is_some());
    assert!(role_vocabulary(classes).contains("families: brand"));
    assert!(tone_vocabulary(classes).contains("deliveries: filled"));
}
