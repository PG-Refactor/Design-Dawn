// The largest display size at which a block's content fits the block, for "fit to the
// block". Text wraps, so its height is not proportional to the size: the size is found by
// halving the range and laying the content out at each try.

import { CANVAS_CONFIG } from "../../config/canvas-config";
import {
  CONTENT_SCALE_MAX_PERCENT,
  CONTENT_SCALE_MIN_PERCENT,
} from "../../domain/domain-constants";

const PERCENT = 100;

// `fits(percent)` lays the content out at that size and tells whether it is all inside.
// The smallest size is the answer when nothing fits; the largest when everything does.
export function largestFittingPercent(
  fits: (percent: number) => boolean,
): number {
  if (fits(CONTENT_SCALE_MAX_PERCENT)) return CONTENT_SCALE_MAX_PERCENT;
  let low = CONTENT_SCALE_MIN_PERCENT;
  let high = CONTENT_SCALE_MAX_PERCENT;
  for (let step = 0; step < CANVAS_CONFIG.block.fitSearchSteps; step += 1) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return Math.floor(low);
}

// What a fitted picture is shown at: its natural size against the room it has.
export function fittedPicturePercent(
  natural: { readonly width: number; readonly height: number },
  room: { readonly width: number; readonly height: number },
): number | null {
  if (natural.width <= 0 || natural.height <= 0) return null;
  return Math.round(
    Math.min(room.width / natural.width, room.height / natural.height) *
      PERCENT,
  );
}

export function zoomOf(percent: number): number {
  return percent / PERCENT;
}
