//! The name grammars of the colour floors, read against the configured closed lists.

use crate::config::{ClassesConfig, SURFACE};

/// A parsed Role name (the part after `--color-`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoleName<'a> {
    /// `<family>-<slot>[-<state>]`.
    Family {
        family: &'a str,
        slot: &'a str,
        state: Option<&'a str>,
    },
    /// `surface-<level>`.
    Surface { level: &'a str },
}

/// A parsed Tone name (the part after `tone-`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToneName<'a> {
    /// `<family>-<delivery>`.
    Family { family: &'a str, delivery: &'a str },
    /// `surface-<level>`.
    Surface { level: &'a str },
}

/// The configured family `name` starts with, followed by `-`, and the rest.
fn family<'a>(name: &'a str, config: &ClassesConfig) -> Option<(&'a str, &'a str)> {
    config.families.iter().find_map(|family| {
        name.strip_prefix(family.as_str())
            .and_then(|rest| rest.strip_prefix('-'))
            .map(|rest| (&name[..family.len()], rest))
    })
}

fn surface<'a>(name: &'a str, config: &ClassesConfig) -> Option<&'a str> {
    name.strip_prefix(SURFACE)
        .and_then(|rest| rest.strip_prefix('-'))
        .filter(|level| config.surface_levels.iter().any(|known| known == level))
}

/// Parses a Role name; `None` when it is outside the grammar or the closed lists.
pub fn role<'a>(name: &'a str, config: &ClassesConfig) -> Option<RoleName<'a>> {
    if let Some(level) = surface(name, config) {
        return Some(RoleName::Surface { level });
    }

    let (family, rest) = family(name, config)?;
    let mut slots: Vec<&String> = config.slots.iter().collect();
    slots.sort_by_key(|slot| std::cmp::Reverse(slot.len()));

    slots.into_iter().find_map(|slot| {
        let slot = slot.as_str();
        if rest == slot {
            return Some(RoleName::Family {
                family,
                slot: &rest[..slot.len()],
                state: None,
            });
        }
        let state = rest.strip_prefix(slot)?.strip_prefix('-')?;
        config
            .states
            .iter()
            .any(|known| known == state)
            .then_some(RoleName::Family {
                family,
                slot: &rest[..slot.len()],
                state: Some(state),
            })
    })
}

/// Parses a Tone name without its `tone-` prefix; `None` outside the grammar or the lists.
pub fn tone<'a>(name: &'a str, config: &ClassesConfig) -> Option<ToneName<'a>> {
    if let Some(level) = surface(name, config) {
        return Some(ToneName::Surface { level });
    }

    let (family, delivery) = family(name, config)?;
    config
        .delivery(delivery)
        .map(|_| ToneName::Family { family, delivery })
}

/// `families: a, b, c; slots: …; states: …` for messages about Role names.
pub fn role_vocabulary(config: &ClassesConfig) -> String {
    format!(
        "families: {}; slots: {}; states: {}; surface levels: {}",
        config.families.join(", "),
        config.slots.join(", "),
        config.states.join(", "),
        config.surface_levels.join(", ")
    )
}

/// `families: …; deliveries: …; surface levels: …` for messages about Tone names.
pub fn tone_vocabulary(config: &ClassesConfig) -> String {
    let deliveries: Vec<&str> = config
        .deliveries
        .iter()
        .map(|(delivery, _)| delivery.as_str())
        .collect();
    format!(
        "families: {}; deliveries: {}; surface levels: {}",
        config.families.join(", "),
        deliveries.join(", "),
        config.surface_levels.join(", ")
    )
}

#[cfg(test)]
mod tests;
