//! Rules about the edges of the tracked world: transactions, server-safety, untrackable data and
//! subscriptions that outlive their purpose.

pub mod no_async_transaction;
pub mod no_module_level_store;
pub mod no_untrackable_store_data;
pub mod require_subscription_disposal;
