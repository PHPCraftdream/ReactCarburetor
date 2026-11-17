//! The scaffold's raw colours: Tailwind's palette for the hues the default families use, grey for
//! any other family until its author picks a hue.

/// The steps every hue carries.
const STEPS: [u32; 9] = [50, 100, 300, 500, 600, 700, 800, 900, 950];

/// Tailwind's values for the default hues, by step in `STEPS` order.
const HUES: [(&str, [&str; 9]); 5] = [
    (
        "gray",
        [
            "#f9fafb", "#f3f4f6", "#d1d5db", "#6b7280", "#4b5563", "#374151", "#1f2937", "#111827",
            "#030712",
        ],
    ),
    (
        "blue",
        [
            "#eff6ff", "#dbeafe", "#93c5fd", "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af", "#1e3a8a",
            "#172554",
        ],
    ),
    (
        "red",
        [
            "#fef2f2", "#fee2e2", "#fca5a5", "#ef4444", "#dc2626", "#b91c1c", "#991b1b", "#7f1d1d",
            "#450a0a",
        ],
    ),
    (
        "green",
        [
            "#f0fdf4", "#dcfce7", "#86efac", "#22c55e", "#16a34a", "#15803d", "#166534", "#14532d",
            "#052e16",
        ],
    ),
    (
        "amber",
        [
            "#fffbeb", "#fef3c7", "#fcd34d", "#f59e0b", "#d97706", "#b45309", "#92400e", "#78350f",
            "#451a03",
        ],
    ),
];

/// The hue a family paints with: the default families' conventional hues, and the family's own
/// name for any other, so its tokens are easy to find and recolour.
pub(super) fn hue_of(family: &str) -> String {
    match family {
        "neutral" => "gray",
        "accent" => "blue",
        "danger" => "red",
        "success" => "green",
        "warning" => "amber",
        other => other,
    }
    .to_string()
}

/// The value of one step of a hue; an unknown hue takes grey's.
fn value(hue: &str, step: u32) -> &'static str {
    let index = STEPS.iter().position(|known| *known == step).unwrap_or(3);
    HUES.iter()
        .find(|(name, _)| *name == hue)
        .map_or(HUES[0].1[index], |(_, values)| values[index])
}

/// The tokens the Roles reference, in first-use order, each once.
#[derive(Debug, Default)]
pub(super) struct Palette {
    tokens: Vec<(String, &'static str)>,
}

impl Palette {
    /// Records the token for a hue's step (`None` is white) and returns the `var(…)` a Role uses.
    pub(super) fn take(&mut self, hue: &str, step: Option<u32>) -> String {
        let (name, colour) = match step {
            Some(step) => (format!("{hue}-{step}"), value(hue, step)),
            None => ("white".to_string(), "#ffffff"),
        };
        let reference = format!("var(--palette-{name})");
        if !self.tokens.iter().any(|(known, _)| *known == name) {
            self.tokens.push((name, colour));
        }
        reference
    }

    /// How many tokens were taken.
    pub(super) fn len(&self) -> usize {
        self.tokens.len()
    }

    /// The `--palette-*` declarations, one per line.
    pub(super) fn declarations(&self) -> String {
        self.tokens
            .iter()
            .map(|(name, colour)| format!("  --palette-{name}: {colour};\n"))
            .collect()
    }
}
