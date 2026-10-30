// Converts fractional UI values (drag / resize previews) into validated domain values at
// commit time. The UI never builds Position / Size by casting.

import type { DomainResult } from "../domain/shared/domain-result";
import {
  type Position,
  parsePosition,
  parseSize,
  type Size,
} from "../domain/shared/geometry";

export interface FractionalPoint {
  readonly x: number;
  readonly y: number;
}

export interface FractionalExtent {
  readonly width: number;
  readonly height: number;
}

// `+ 0` turns -0 (from rounding -0.4) into 0 so stored values compare equal to literals.
function roundToInteger(value: number): number {
  return Math.round(value) + 0;
}

export function commitPosition(point: FractionalPoint): DomainResult<Position> {
  return parsePosition({
    x: roundToInteger(point.x),
    y: roundToInteger(point.y),
  });
}

export function commitSize(extent: FractionalExtent): DomainResult<Size> {
  return parseSize({
    width: roundToInteger(extent.width),
    height: roundToInteger(extent.height),
  });
}
