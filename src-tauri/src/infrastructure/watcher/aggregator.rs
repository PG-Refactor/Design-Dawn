use std::collections::BTreeSet;
use std::time::{Duration, Instant};

/// Everything seen since the last batch.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct WatchBatch {
    /// Project-root-relative `/`-separated paths that an event named.
    pub paths: BTreeSet<String>,
    /// Events may have been lost (or the watcher failed): compare everything.
    pub rescan: bool,
}

/// Collects events into batches. Time is passed in, never read, so the behaviour is tested
/// deterministically: a batch is due `quiet_period` after the last event, but no later than
/// `max_delay` after the first event of the batch.
#[derive(Debug)]
pub struct Aggregator {
    quiet_period: Duration,
    max_delay: Duration,
    pending: WatchBatch,
    first_event_at: Option<Instant>,
    last_event_at: Option<Instant>,
}

impl Aggregator {
    pub fn new(quiet_period: Duration, max_delay: Duration) -> Self {
        Self {
            quiet_period,
            max_delay,
            pending: WatchBatch::default(),
            first_event_at: None,
            last_event_at: None,
        }
    }

    fn note_event(&mut self, now: Instant) {
        self.first_event_at.get_or_insert(now);
        self.last_event_at = Some(now);
    }

    pub fn record_paths(&mut self, paths: impl IntoIterator<Item = String>, now: Instant) {
        let before = self.pending.paths.len();
        self.pending.paths.extend(paths);
        if self.pending.paths.len() != before || self.last_event_at.is_none() {
            self.note_event(now);
        } else {
            // The same paths again still count as activity: the burst is not over.
            self.last_event_at = Some(now);
        }
    }

    pub fn record_rescan(&mut self, now: Instant) {
        self.pending.rescan = true;
        self.note_event(now);
    }

    /// When the pending batch becomes due, or `None` with nothing pending.
    pub fn next_deadline(&self) -> Option<Instant> {
        let first = self.first_event_at?;
        let last = self.last_event_at?;
        Some((last + self.quiet_period).min(first + self.max_delay))
    }

    /// The batch, if it is due at `now`; the aggregator is empty afterwards.
    pub fn take_due(&mut self, now: Instant) -> Option<WatchBatch> {
        let deadline = self.next_deadline()?;
        if now < deadline {
            return None;
        }
        self.first_event_at = None;
        self.last_event_at = None;
        Some(std::mem::take(&mut self.pending))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const QUIET: Duration = Duration::from_millis(300);
    const MAX: Duration = Duration::from_secs(2);

    fn aggregator() -> (Aggregator, Instant) {
        (Aggregator::new(QUIET, MAX), Instant::now())
    }

    fn path(text: &str) -> String {
        text.to_owned()
    }

    #[test]
    fn nothing_pending_means_no_deadline_and_no_batch() {
        let (mut aggregator, start) = aggregator();
        assert_eq!(aggregator.next_deadline(), None);
        assert_eq!(aggregator.take_due(start + MAX), None);
    }

    #[test]
    fn a_batch_is_due_after_the_quiet_period() {
        let (mut aggregator, start) = aggregator();
        aggregator.record_paths([path("a")], start);
        assert_eq!(aggregator.next_deadline(), Some(start + QUIET));
        assert_eq!(
            aggregator.take_due(start + QUIET - Duration::from_millis(1)),
            None
        );
        let batch = aggregator.take_due(start + QUIET).unwrap();
        assert_eq!(batch.paths, BTreeSet::from([path("a")]));
        assert!(!batch.rescan);
        assert_eq!(aggregator.next_deadline(), None);
    }

    #[test]
    fn every_event_pushes_the_deadline_back_while_the_burst_lasts() {
        let (mut aggregator, start) = aggregator();
        aggregator.record_paths([path("a")], start);
        aggregator.record_paths([path("b")], start + Duration::from_millis(200));
        aggregator.record_paths([path("a")], start + Duration::from_millis(400));
        assert_eq!(
            aggregator.next_deadline(),
            Some(start + Duration::from_millis(700))
        );
        assert_eq!(
            aggregator.take_due(start + Duration::from_millis(699)),
            None
        );
        let batch = aggregator
            .take_due(start + Duration::from_millis(700))
            .unwrap();
        assert_eq!(batch.paths, BTreeSet::from([path("a"), path("b")]));
    }

    #[test]
    fn a_continuous_burst_is_cut_at_the_maximum_delay() {
        let (mut aggregator, start) = aggregator();
        let mut elapsed = Duration::ZERO;
        while elapsed < Duration::from_secs(5) {
            aggregator.record_paths([path("busy")], start + elapsed);
            elapsed += Duration::from_millis(100);
        }
        assert_eq!(aggregator.next_deadline(), Some(start + MAX));
        assert!(aggregator.take_due(start + MAX).is_some());
    }

    #[test]
    fn the_next_batch_starts_fresh_after_one_was_taken() {
        let (mut aggregator, start) = aggregator();
        aggregator.record_paths([path("a")], start);
        aggregator.take_due(start + QUIET).unwrap();
        let later = start + Duration::from_secs(10);
        aggregator.record_paths([path("b")], later);
        assert_eq!(aggregator.next_deadline(), Some(later + QUIET));
        let batch = aggregator.take_due(later + QUIET).unwrap();
        assert_eq!(batch.paths, BTreeSet::from([path("b")]));
    }

    #[test]
    fn a_lost_event_marks_the_batch_for_a_full_comparison() {
        let (mut aggregator, start) = aggregator();
        aggregator.record_rescan(start);
        let batch = aggregator.take_due(start + QUIET).unwrap();
        assert!(batch.rescan);
        assert!(batch.paths.is_empty());
        aggregator.record_paths([path("a")], start + QUIET);
        let next = aggregator.take_due(start + QUIET * 2).unwrap();
        assert!(!next.rescan);
    }
}
