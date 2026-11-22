import { describe, expect, it } from "vitest";
import { withAssetRevision } from "./asset-revision";

describe("withAssetRevision", () => {
  it("leaves the address alone before the first raise", () => {
    expect(withAssetRevision("dawn-asset://p/d/assets/a.png", 0)).toBe(
      "dawn-asset://p/d/assets/a.png",
    );
  });

  it("adds the revision as a query, after one already there", () => {
    expect(withAssetRevision("dawn-asset://p/d/assets/a.png", 3)).toBe(
      "dawn-asset://p/d/assets/a.png?v=3",
    );
    expect(withAssetRevision("http://x/a.png?w=1", 3)).toBe(
      "http://x/a.png?w=1&v=3",
    );
  });
});
