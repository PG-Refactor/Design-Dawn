import { describe, expect, it } from "vitest";
import { itemAt } from "./item-at";

describe("itemAt", () => {
  it("is the item at the index, or the fallback outside the list", () => {
    expect(itemAt(["a", "b"], 1, "")).toBe("b");
    expect(itemAt(["a", "b"], 2, "none")).toBe("none");
    expect(itemAt("ab", 0, "")).toBe("a");
  });
});
