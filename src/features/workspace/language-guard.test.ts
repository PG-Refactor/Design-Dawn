import { describe, expect, it } from "vitest";

// Production code reaches a catalog only through the current display language
// (`useMessages()`, or a catalog passed in as a parameter), never through a fixed one.
const sources = import.meta.glob("../../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const CATALOG_FILE =
  /\/(?:workspace|canvas|markdown|image|git)-messages(?:-ja|-en)?\.ts$/;
const FIXED_LANGUAGE_PATTERNS: readonly RegExp[] = [
  /\b[A-Z]+_MESSAGES(?:\.|\[\s*["'])(?:ja|en)\b/,
  /\bmessagesFor\(\s*["']/,
];

function isProductionFile(file: string): boolean {
  return (
    !/\.test\.tsx?$/.test(file) &&
    !file.includes("/test-support/") &&
    !CATALOG_FILE.test(file)
  );
}

function usesFixedLanguage(source: string): boolean {
  return FIXED_LANGUAGE_PATTERNS.some((pattern) => pattern.test(source));
}

describe("display language guard", () => {
  const files = Object.entries(sources).filter(([file]) =>
    isProductionFile(file),
  );

  it("scans the production sources", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some(([file]) => file.endsWith("use-messages.ts"))).toBe(true);
  });

  it("never picks a catalog language by a fixed value", () => {
    const violations = files
      .filter(([, source]) => usesFixedLanguage(source))
      .map(([file]) => file);
    expect(violations).toEqual([]);
  });

  it("detects the fixed-language forms", () => {
    expect(usesFixedLanguage("GIT_MESSAGES.ja.refresh")).toBe(true);
    expect(usesFixedLanguage('WORKSPACE_MESSAGES["en"]')).toBe(true);
    expect(usesFixedLanguage('messagesFor("ja")')).toBe(true);
    expect(usesFixedLanguage("WORKSPACE_MESSAGES[language]")).toBe(false);
    expect(usesFixedLanguage("messagesFor(language)")).toBe(false);
  });
});
