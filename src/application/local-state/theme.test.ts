import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_PREFERENCE,
  FALLBACK_RESOLVED_THEME,
  parseThemePreference,
  resolveTheme,
  THEME_DEFINITIONS,
  THEME_PREFERENCES,
} from "./theme";

describe("resolveTheme", () => {
  it("follows the OS theme for system", () => {
    expect(resolveTheme("system", "light")).toBe("light");
    expect(resolveTheme("system", "dark")).toBe("dark");
  });

  it("uses the fallback theme when the OS theme is unknown", () => {
    expect(resolveTheme("system", null)).toBe(FALLBACK_RESOLVED_THEME);
    expect(FALLBACK_RESOLVED_THEME).toBe("light");
  });

  it("lets an explicit preference override the OS theme", () => {
    expect(resolveTheme("light", "dark")).toBe("light");
    expect(resolveTheme("dark", "light")).toBe("dark");
    expect(resolveTheme("dark", null)).toBe("dark");
  });
});

describe("theme definitions", () => {
  it("derives the preferences from the definition table", () => {
    expect(THEME_PREFERENCES).toEqual([
      "system",
      ...THEME_DEFINITIONS.map((definition) => definition.id),
    ]);
  });

  it("defaults to system", () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe("system");
  });
});

describe("parseThemePreference", () => {
  it("accepts every preference", () => {
    for (const preference of THEME_PREFERENCES) {
      expect(parseThemePreference(preference)).toEqual({
        ok: true,
        value: preference,
      });
    }
  });

  it("rejects anything else with invalidThemePreference", () => {
    for (const value of ["Dark", "sepia", "", "dark ", "auto"]) {
      const result = parseThemePreference(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalidThemePreference");
    }
  });
});
