import {
  POSITION_MAX,
  POSITION_MIN,
  SIZE_MAX,
  SIZE_MIN,
} from "../domain-constants";
import type { Brand } from "./brand";
import { type DomainResult, err, ok } from "./domain-result";

export type Position = Brand<
  { readonly x: number; readonly y: number },
  "Position"
>;
export type Size = Brand<
  { readonly width: number; readonly height: number },
  "Size"
>;

export interface RawPosition {
  readonly x: number;
  readonly y: number;
}

export interface RawSize {
  readonly width: number;
  readonly height: number;
}

function isIntegerInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function parsePosition(raw: RawPosition): DomainResult<Position> {
  if (!isIntegerInRange(raw.x, POSITION_MIN, POSITION_MAX)) {
    return err("invalidPosition", `x is not an integer in range: ${raw.x}`);
  }
  if (!isIntegerInRange(raw.y, POSITION_MIN, POSITION_MAX)) {
    return err("invalidPosition", `y is not an integer in range: ${raw.y}`);
  }
  return ok({ x: raw.x, y: raw.y } as Position);
}

export function parseSize(raw: RawSize): DomainResult<Size> {
  if (!isIntegerInRange(raw.width, SIZE_MIN, SIZE_MAX)) {
    return err("invalidSize", `width is not an integer in range: ${raw.width}`);
  }
  if (!isIntegerInRange(raw.height, SIZE_MIN, SIZE_MAX)) {
    return err(
      "invalidSize",
      `height is not an integer in range: ${raw.height}`,
    );
  }
  return ok({ width: raw.width, height: raw.height } as Size);
}
