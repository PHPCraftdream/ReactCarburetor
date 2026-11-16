//! Rules about effects: an async body that loses its cleanup, a duplicate name, a missing dep, a
//! dependency read from a store that the effect cannot follow.

pub mod no_async_effect;
pub mod no_duplicate_effect_name;
pub mod no_store_read_in_effect_deps;
pub mod require_effect_deps;
