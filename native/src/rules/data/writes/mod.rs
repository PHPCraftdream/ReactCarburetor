//! Rules about writing state: a write that records no path, reaches no subscriber, or is lost.

pub mod no_direct_data_write;
pub mod no_external_data_mutation;
pub mod no_store_write_in_render;
pub mod no_tracked_data_mutation;
pub mod no_untrackable_draft_mutation;
pub mod require_emit_after_draft_write;
