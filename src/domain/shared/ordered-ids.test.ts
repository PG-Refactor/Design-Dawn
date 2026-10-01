import { describe, expect, it } from "vitest";
import { addToOrder, moveInOrder, removeFromOrder } from "./ordered-ids";
import { unwrap } from "./test-support";

describe("ordered ids", () => {
  const order = ["a", "b", "c"] as const;

  it("appends an id", () => {
    expect(unwrap(addToOrder(order, "d"))).toEqual(["a", "b", "c", "d"]);
  });

  it("rejects adding a duplicate", () => {
    const result = addToOrder(order, "b");
    expect(!result.ok && result.error.kind).toBe("duplicateId");
  });

  it("removes an id", () => {
    expect(unwrap(removeFromOrder(order, "b"))).toEqual(["a", "c"]);
  });

  it("reports a missing id on remove", () => {
    const result = removeFromOrder(order, "z");
    expect(!result.ok && result.error.kind).toBe("entityNotFound");
  });

  it("moves an id before another", () => {
    expect(unwrap(moveInOrder(order, "c", "a"))).toEqual(["c", "a", "b"]);
    expect(unwrap(moveInOrder(order, "a", "c"))).toEqual(["b", "a", "c"]);
  });

  it("moves an id to the end when target is null", () => {
    expect(unwrap(moveInOrder(order, "a", null))).toEqual(["b", "c", "a"]);
  });

  it("treats moving before itself as a no-op", () => {
    expect(unwrap(moveInOrder(order, "b", "b"))).toEqual(order);
  });

  it("reports unknown ids on move", () => {
    const unknownId = moveInOrder(order, "z", null);
    const unknownTarget = moveInOrder(order, "a", "z");
    expect(!unknownId.ok && unknownId.error.kind).toBe("entityNotFound");
    expect(!unknownTarget.ok && unknownTarget.error.kind).toBe(
      "entityNotFound",
    );
  });

  it("does not mutate its input", () => {
    const input = ["a", "b"];
    moveInOrder(input, "a", null);
    addToOrder(input, "c");
    removeFromOrder(input, "a");
    expect(input).toEqual(["a", "b"]);
  });
});
