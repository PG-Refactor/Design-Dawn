import { describe, expect, it } from "vitest";
import { parseDisplayName } from "./display-name";

describe("parseDisplayName (TypeScript-only cases)", () => {
  it("rejects a lone high surrogate", () => {
    const result = parseDisplayName("a\ud800b");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalidDisplayName");
  });

  it("rejects a lone low surrogate", () => {
    const result = parseDisplayName("\udc00");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalidDisplayName");
  });

  it("accepts a valid surrogate pair", () => {
    expect(parseDisplayName("🚀").ok).toBe(true);
  });
});
