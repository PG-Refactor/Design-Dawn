import { describe, expect, it } from "vitest";
import { unwrap } from "../domain/shared/test-support";
import { commitPosition, commitSize } from "./commit-geometry";

describe("commitPosition / commitSize", () => {
  it("rounds fractional values to integers", () => {
    expect(unwrap(commitPosition({ x: 103.72, y: -0.4 }))).toEqual({
      x: 104,
      y: 0,
    });
    expect(unwrap(commitSize({ width: 99.5, height: 10.2 }))).toEqual({
      width: 100,
      height: 10,
    });
  });

  it("normalises negative zero", () => {
    expect(Object.is(unwrap(commitPosition({ x: -0.4, y: 0 })).x, 0)).toBe(
      true,
    );
  });

  it("rejects values that are invalid after rounding", () => {
    const tooSmall = commitSize({ width: 0.4, height: 10 });
    expect(!tooSmall.ok && tooSmall.error.kind).toBe("invalidSize");
    const notFinite = commitPosition({ x: Number.NaN, y: 0 });
    expect(!notFinite.ok && notFinite.error.kind).toBe("invalidPosition");
    const outOfRange = commitPosition({ x: 3_000_000_000, y: 0 });
    expect(!outOfRange.ok && outOfRange.error.kind).toBe("invalidPosition");
  });
});
