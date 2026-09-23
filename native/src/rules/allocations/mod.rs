//! Rules about allocation hygiene: a closure rebuilt on every call that the class could own as a
//! method instead.

pub mod require_method_for_closure;
