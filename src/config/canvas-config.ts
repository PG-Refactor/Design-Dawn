// Canvas configuration (docs/architecture.md §6.2.2). The viewport limits are validated by
// the local state parser and by Rust (`application/local_state/constants.rs`); the canvas
// implementation in a later step must clamp to the same values. Shared fixtures
// (fixtures/app-state/) keep the two languages in sync.
export const CANVAS_CONFIG = {
  viewport: {
    // Large enough for the world coordinate range at the maximum zoom.
    panLimit: 100_000_000_000,
    zoomMin: 0.1,
    zoomMax: 8,
  },
} as const;
