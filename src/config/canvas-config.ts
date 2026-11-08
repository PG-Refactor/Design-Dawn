// Canvas configuration. The viewport limits are validated by
// the local state parser and by Rust (`application/local_state/constants.rs`); the canvas
// implementation in a later step must clamp to the same values. Shared fixtures
// (fixtures/app-state/) keep the two languages in sync.
// How far inside the canvas edge the sheet's top-left corner can be brought, in WORLD units:
// one grid step (`grid.interval`), so blocks at the corner are not cut by the edge (their
// outline and shadow are drawn outside them) and the corner sits on a grid dot.
const ORIGIN_MARGIN = 24;

export const CANVAS_CONFIG = {
  viewport: {
    // Large enough for the world coordinate range at the maximum zoom.
    panLimit: 100_000_000_000,
    zoomMin: 0.1,
    zoomMax: 8,
    originMargin: ORIGIN_MARGIN,
    // Shown for a sheet that has no saved viewport: 100 %, the top-left corner one margin
    // inside the edge.
    default: { panX: ORIGIN_MARGIN, panY: ORIGIN_MARGIN, zoom: 1 },
    // Quiet period after the last viewport change before it is saved, so a pan or a
    // wheel gesture produces one save instead of one per event.
    saveDelayMs: 500,
  },
  zoom: {
    // Wheel zoom is exponential (factor = exp(-wheelDelta * wheelStep)) so zooming in and
    // out by the same wheel distance cancels out. 0.002 turns one typical mouse notch
    // (deltaY 100) into about 22 %.
    wheelStep: 0.002,
    // The stops of the zoom control's - / + buttons (as in a browser): a button goes to the
    // next stop below / above the current zoom, whatever the wheel left it at. Within the
    // viewport limits; the first and last are those limits.
    steps: [
      0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3,
      4, 5, 6, 8,
    ],
  },
  interaction: {
    // Screen pixels the pointer must travel before a press becomes a drag / resize / pan;
    // below it the gesture is a click.
    dragThresholdPx: 4,
  },
  block: {
    // Lower bound of a resize in the app and of a size set by AI (world units; the MCP
    // server's `BLOCK_MIN_WIDTH` / `BLOCK_MIN_HEIGHT` mirror it). The file format accepts any
    // size >= 1, so a file edited by hand may hold a smaller Block.
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
