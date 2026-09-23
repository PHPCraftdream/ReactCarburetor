//! Rules about allocation hygiene: a closure rebuilt on every call that the class could own as a
//! method instead, and code that needs no class at all and belongs at module level.

pub mod require_method_for_closure;
pub mod require_module_function;
