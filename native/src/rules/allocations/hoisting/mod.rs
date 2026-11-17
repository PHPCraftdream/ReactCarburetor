//! Work a function repeats on every call that could be done once: a mutator closure rebuilt for
//! `this.update`, and a collection or string assembled entirely from constants.

pub mod no_closure_in_update;
pub mod require_hoisted_constant;
