//! Rules about effects: an async body that loses its cleanup, a duplicate name, a missing dep, a
//! dependency read from a store that the effect cannot follow, a store effect re-subscribed on
//! every render, and a store watched by hand where `useStoreEffect` would.

pub mod no_async_effect;
pub mod no_duplicate_effect_name;
pub mod no_inline_store_effect;
pub mod no_store_read_in_effect_deps;
pub mod prefer_store_effect;
pub mod require_effect_deps;
