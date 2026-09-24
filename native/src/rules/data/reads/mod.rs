//! Rules about reading state: a read that subscribes to nothing, and tracked data that escapes.

pub mod no_computed_get_in_computed;
pub mod no_computed_get_in_render;
pub mod no_escaping_tracked_data;
pub mod no_get_data_in_render;
pub mod no_use_carburetor_outside_render;
