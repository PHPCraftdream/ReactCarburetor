//! Rules about allocation hygiene: a closure rebuilt on every call that the class could own as a
//! method instead, code that needs no class at all and belongs at module level, and values built
//! from constants on every call.

mod hoisting;
pub use hoisting::{no_closure_in_update, require_hoisted_constant};
pub mod no_react_hooks_in_components;
pub mod require_method_for_closure;
pub mod require_module_function;
