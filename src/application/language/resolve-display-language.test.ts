import { describe, expect, it } from "vitest";
import { resolveDisplayLanguage } from "./resolve-display-language";

describe("resolveDisplayLanguage", () => {
  it.each(["en", "ja"] as const)(
    "uses an explicit %s regardless of the system languages",
    (preference) => {
      expect(resolveDisplayLanguage(preference, ["fr-FR"])).toBe(preference);
      expect(resolveDisplayLanguage(preference, [])).toBe(preference);
    },
  );

  it.each([
    [["ja"]],
    [["ja-JP"]],
    [["JA"]],
    [["Ja-jp"]],
    [["fr", "ja-JP"]],
    [["jav", "ja"]],
  ])("resolves system to ja for %j", (systemLanguages) => {
    expect(resolveDisplayLanguage("system", systemLanguages)).toBe("ja");
  });

  it.each([
    [[]],
    [["en"]],
    [["en-US", "fr"]],
    [["en-US", "ja"]],
    [["EN-gb", "ja"]],
    [["jav"]],
    [["jam-XX"]],
    [[""]],
  ])("resolves system to en for %j", (systemLanguages) => {
    expect(resolveDisplayLanguage("system", systemLanguages)).toBe("en");
  });
});
