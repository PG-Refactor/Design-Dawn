//! File system watching for external changes (docs/architecture.md §14.3, §14.4).
//!
//! `notify` is wrapped thinly: an event is only a hint that "something under the Project may
//! have changed". Filtering and aggregation are plain logic with injected time so they are
//! tested without a file system; deciding what really changed is the application layer's job
//! (it compares with the hash ledger).

mod aggregator;
mod constants;
mod filter;
mod project_watcher;

pub use aggregator::{Aggregator, WatchBatch};
pub use constants::{AGGREGATION_MAX_DELAY, AGGREGATION_QUIET_PERIOD};
pub use filter::watched_relative_path;
pub use project_watcher::{ProjectWatcher, WatchStartError};
