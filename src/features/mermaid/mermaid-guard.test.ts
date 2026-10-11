import { describe, expect, it } from "vitest";

// The Mermaid rules of docs/architecture.md §15.4 and docs/security.md §7 as source checks.
// Like the Markdown guard this reads source text, so it cannot see indirect use (a string
// built at run time); tests and test support files are excluded because they name the
// patterns. The HTML injection rules are in markdown-guard.test.ts and cover Mermaid too.
const sources = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const productionSources = Object.entries(sources).filter(
  ([file]) => !/\.test\.tsx?$/.test(file) && !file.includes("/test-support/"),
);

const RENDERER_FILE = "/src/features/mermaid/render-mermaid.ts";
const CONFIG_FILE = "/src/features/mermaid/mermaid-config.ts";
const PREVIEW_COMPONENT_FILE =
  "/src/features/mermaid/mermaid-diagram-preview.tsx";

function filesMatching(pattern: RegExp): string[] {
  return productionSources
    .filter(([, source]) => pattern.test(source))
    .map(([file]) => file);
}

// Static `from "mermaid"`, type-only imports and dynamic `import("mermaid")`.
const MERMAID_IMPORT = /(?:from\s*|import\s*\(\s*)["']mermaid(?:\/[^"']*)?["']/;
const SECURITY_LEVEL_SETTING = /securityLevel/;
const STRICT_LITERAL = /["']strict["']/;

describe("mermaid guard", () => {
  it("scans the production sources", () => {
    expect(Object.keys(sources)).toContain(RENDERER_FILE);
    expect(Object.keys(sources)).toContain(CONFIG_FILE);
    expect(productionSources.length).toBeGreaterThan(50);
  });

  it("imports mermaid in render-mermaid.ts only", () => {
    expect(filesMatching(MERMAID_IMPORT)).toEqual([RENDERER_FILE]);
  });

  it("keeps mermaid out of the domain and application layers", () => {
    const offenders = productionSources
      .filter(
        ([file]) =>
          file.startsWith("/src/domain/") ||
          file.startsWith("/src/application/"),
      )
      .filter(([, source]) => MERMAID_IMPORT.test(source));
    expect(offenders).toEqual([]);
  });

  it("loads mermaid lazily, so the library is a separate chunk", () => {
    const renderer = sources[RENDERER_FILE] ?? "";
    expect(renderer).toMatch(/import\s*\(\s*["']mermaid["']\s*\)/);
    expect(renderer).not.toMatch(/^\s*import\b[^(]*from\s*["']mermaid/m);
  });

  it("names the security level in the config file only", () => {
    expect(filesMatching(SECURITY_LEVEL_SETTING)).toEqual([CONFIG_FILE]);
    expect(filesMatching(STRICT_LITERAL)).toEqual([CONFIG_FILE]);
  });

  it("puts the diagram into the page only as an image address", () => {
    const component = sources[PREVIEW_COMPONENT_FILE] ?? "";
    expect(component).toMatch(/<img\b/);
    expect(
      filesMatching(
        /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML/,
      ).filter((file) => file.startsWith("/src/features/mermaid/")),
    ).toEqual([]);
  });

  it("detects the patterns it guards", () => {
    expect(MERMAID_IMPORT.test('import m from "mermaid"')).toBe(true);
    expect(MERMAID_IMPORT.test("import type { X } from 'mermaid'")).toBe(true);
    expect(MERMAID_IMPORT.test('await import("mermaid")')).toBe(true);
    expect(MERMAID_IMPORT.test('import x from "./mermaid-config"')).toBe(false);
    expect(STRICT_LITERAL.test('securityLevel: "strict"')).toBe(true);
  });
});
