import { describe, expect, it } from "vitest";
import { APP_CONFIG } from "./app-config";

describe("APP_CONFIG", () => {
  it("has a non-empty display name", () => {
    expect(APP_CONFIG.displayName.length).toBeGreaterThan(0);
  });
});
