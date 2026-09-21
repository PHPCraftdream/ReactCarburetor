//! Rules about effects: an async body that loses its cleanup, a duplicate name, a missing dep.

pub mod no_async_effect;
pub mod no_duplicate_effect_name;
pub mod require_effect_deps;
