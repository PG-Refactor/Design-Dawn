import { describe, expect, it } from "vitest";
import { applyTheme, THEME_ATTRIBUTE_NAME } from "./apply-theme";

function fakeTarget() {
  const attributes = new Map<string, string>();
  return {
    attributes,
    style: { colorScheme: "" },
    setAttribute: (name: string, value: string) => attributes.set(name, value),
  };
}

describe("applyTheme", () => {
  it.each(["light", "dark"] as const)(
    "sets data-theme and color-scheme for %s",
    (theme) => {
      const target = fakeTarget();
      applyTheme(target, theme);
      expect(target.attributes.get(THEME_ATTRIBUTE_NAME)).toBe(theme);
      expect(target.style.colorScheme).toBe(theme);
    },
  );

  it("switches from one theme to the other", () => {
    const target = fakeTarget();
    applyTheme(target, "light");
    applyTheme(target, "dark");
    expect(target.attributes.get("data-theme")).toBe("dark");
    expect(target.style.colorScheme).toBe("dark");
  });
});
