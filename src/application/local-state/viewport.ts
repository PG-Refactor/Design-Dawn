// Per-sheet viewport (docs/architecture.md §6.2.2). Same rules as Rust
// (`application/local_state/viewport.rs`); fractions are allowed (UI state).

import { CANVAS_CONFIG } from "../../config/canvas-config";
import type { Brand } from "../../domain/shared/brand";
import {
  type LocalStateResult,
  localStateErr,
  localStateOk,
} from "./local-state-result";

export interface RawViewport {
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
}

// Branded so that only a validated viewport can be passed to the save wrapper.
export type Viewport = Brand<RawViewport, "Viewport">;

const { panLimit, zoomMin, zoomMax } = CANVAS_CONFIG.viewport;

// `Number.isFinite` also rejects NaN and Infinity, which JSON cannot carry but a
// TypeScript caller can produce.
function isValidPan(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= panLimit;
}

function isValidZoom(value: number): boolean {
  return Number.isFinite(value) && value >= zoomMin && value <= zoomMax;
}

export function parseViewport(raw: RawViewport): LocalStateResult<Viewport> {
  if (
    !isValidPan(raw.panX) ||
    !isValidPan(raw.panY) ||
    !isValidZoom(raw.zoom)
  ) {
    return localStateErr(
      "invalidViewport",
      `panX ${raw.panX} / panY ${raw.panY} must be finite with absolute value <= ${panLimit}, zoom ${raw.zoom} must be finite within [${zoomMin}, ${zoomMax}]`,
    );
  }
  // The checks above are what make this brand sound.
  return localStateOk({
    panX: raw.panX,
    panY: raw.panY,
    zoom: raw.zoom,
  } as Viewport);
}
