// The zoom control's arithmetic: the button stops, the shown percentage and what a typed
// value means. Pure.

import { CANVAS_CONFIG } from "../../../config/canvas-config";

const { zoomMin, zoomMax } = CANVAS_CONFIG.viewport;
const { steps } = CANVAS_CONFIG.zoom;
const PERCENT = 100;
// A zoom this close to a stop counts as on it (the wheel and typed values leave tiny
// floating-point remainders).
const STOP_TOLERANCE = 1e-6;

export type ZoomDirection = "in" | "out";

// The next stop above (in) or below (out) `zoom`; null at the limit.
export function nextZoomStep(
  zoom: number,
  direction: ZoomDirection,
): number | null {
  if (direction === "in") {
    return steps.find((step) => step > zoom + STOP_TOLERANCE) ?? null;
  }
  return (
    [...steps].reverse().find((step) => step < zoom - STOP_TOLERANCE) ?? null
  );
}

// Whole percent, as shown in the control ("100").
export function zoomPercentText(zoom: number): string {
  return String(Math.round(zoom * PERCENT));
}

// A typed percentage ("150", "150%", " 75 % ") as a zoom inside the limits, or null when it
// is not a positive number.
export function parseZoomPercent(text: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(text);
  if (match === null) return null;
  const percent = Number(match[1]);
  if (!Number.isFinite(percent) || percent <= 0) return null;
  return Math.min(zoomMax, Math.max(zoomMin, percent / PERCENT));
}
