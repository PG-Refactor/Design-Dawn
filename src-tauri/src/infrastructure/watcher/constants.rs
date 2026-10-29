use std::time::Duration;

/// A batch is released once no new event arrived for this long, so one save (several events
/// for a temp file, a rename and attribute changes) becomes one batch.
pub const AGGREGATION_QUIET_PERIOD: Duration = Duration::from_millis(300);
/// ...or this long after its first event, so a continuous stream of changes (a build, a
/// `git checkout`) is still reported regularly instead of waiting for it to stop.
pub const AGGREGATION_MAX_DELAY: Duration = Duration::from_secs(2);
