import { describe, expect, it } from "vitest";
import { canMoveOneStep, MOVE_DIRECTIONS, oneStepMove } from "./reorder";

const ORDER = ["a", "b", "c", "d"] as const;

describe("oneStepMove", () => {
  it("up puts the entry in front of its predecessor", () => {
    expect(oneStepMove(ORDER, "c", MOVE_DIRECTIONS.up)).toEqual({
      before: "b",
    });
    expect(oneStepMove(ORDER, "b", MOVE_DIRECTIONS.up)).toEqual({
      before: "a",
    });
  });

  it("down puts the entry in front of the one two places further, or last", () => {
    expect(oneStepMove(ORDER, "a", MOVE_DIRECTIONS.down)).toEqual({
      before: "c",
    });
    expect(oneStepMove(ORDER, "c", MOVE_DIRECTIONS.down)).toEqual({
      before: null,
    });
  });

  it("is null at the boundaries and for unknown entries", () => {
    expect(oneStepMove(ORDER, "a", MOVE_DIRECTIONS.up)).toBeNull();
    expect(oneStepMove(ORDER, "d", MOVE_DIRECTIONS.down)).toBeNull();
    expect(oneStepMove(ORDER, "x", MOVE_DIRECTIONS.up)).toBeNull();
    expect(oneStepMove([], "a", MOVE_DIRECTIONS.down)).toBeNull();
    expect(oneStepMove(["only"], "only", MOVE_DIRECTIONS.up)).toBeNull();
    expect(oneStepMove(["only"], "only", MOVE_DIRECTIONS.down)).toBeNull();
  });

  it("passes over a neighbour whatever it is: positions are of the full order", () => {
    // "failed" stands for an entry that did not load; it still takes a position.
    const order = ["a", "failed", "b"];
    expect(oneStepMove(order, "b", MOVE_DIRECTIONS.up)).toEqual({
      before: "failed",
    });
    expect(oneStepMove(order, "a", MOVE_DIRECTIONS.down)).toEqual({
      before: "b",
    });
  });
});

describe("canMoveOneStep", () => {
  it("mirrors whether a move exists", () => {
    expect(canMoveOneStep(ORDER, "a", MOVE_DIRECTIONS.up)).toBe(false);
    expect(canMoveOneStep(ORDER, "a", MOVE_DIRECTIONS.down)).toBe(true);
    expect(canMoveOneStep(ORDER, "d", MOVE_DIRECTIONS.down)).toBe(false);
    expect(canMoveOneStep(ORDER, "d", MOVE_DIRECTIONS.up)).toBe(true);
  });
});
