//! Rules about the component lifecycle contract: skipping a base implementation, an unstable
//! handler, a method passed without `@bind`.

pub mod no_handler_created_in_render;
pub mod no_lifecycle_class_property;
pub mod require_bind_for_passed_method;
pub mod require_super_in_lifecycle;
