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
    // Shown for a sheet that has no saved viewport (identity transform).
    default: { panX: 0, panY: 0, zoom: 1 },
    // Quiet period after the last viewport change before it is saved, so a pan or a
    // wheel gesture produces one save instead of one per event.
    saveDelayMs: 500,
  },
  zoom: {
    // Wheel zoom is exponential (factor = exp(-wheelDelta * wheelStep)) so zooming in and
    // out by the same wheel distance cancels out. 0.002 turns one typical mouse notch
    // (deltaY 100) into about 22 %.
    wheelStep: 0.002,
  },
  interaction: {
    // Screen pixels the pointer must travel before a press becomes a drag / resize / pan;
    // below it the gesture is a click.
    dragThresholdPx: 4,
  },
  block: {
    // UI-only lower bound of a resize (world units). The domain accepts any size >= 1.
    minSize: { width: 48, height: 32 },
    // Characters of the block id shown in the placeholder and in accessible names. The
    // tail is used because the head of a UUIDv7 is a timestamp shared by nearby blocks.
    shortIdLength: 8,
  },
  grid: {
    // Spacing of the background dots AND the snap interval of block move / resize, in
    // WORLD units (the dots follow pan and zoom, so on screen it is interval * zoom).
    interval: 24,
  },
} as const;

// Offset applied to duplicated blocks so the copy does not hide the original. A tunable
// setting; world coordinates (integers).
export const PASTE_OFFSET = { x: 24, y: 24 } as const;
