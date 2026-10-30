import { describe, expect, it } from "vitest";

// The security rules for rendering Markdown as source checks: the one place that may
// inject HTML, and the two modules that may touch the libraries. Like the other guards
// this reads source text, so it cannot see indirect use (for example a string built at
// run time); tests and test support files are excluded because they name the patterns.
const sources = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const productionSources = Object.entries(sources).filter(
  ([file]) => !/\.test\.tsx?$/.test(file) && !file.includes("/test-support/"),
);

const INJECTION_FILE = "/src/features/markdown/markdown-preview.tsx";
const RENDERER_FILE = "/src/features/markdown/render-markdown.ts";
const SANITIZER_FILE = "/src/features/markdown/sanitize-html.ts";
// The only other module that may use DOMPurify: the Mermaid SVG sanitiser, with its own
// instance. Its further rules are in mermaid-guard.test.ts.
const SVG_SANITIZER_FILE = "/src/features/mermaid/sanitize-svg.ts";

function filesMatching(pattern: RegExp): string[] {
  return productionSources
    .filter(([, source]) => pattern.test(source))
    .map(([file]) => file);
}

const importOf = (packageName: string) =>
  new RegExp(`from\\s*["']${packageName}(?:/[^"']*)?["']`);

describe("markdown security guard", () => {
  it("scans the production sources", () => {
    expect(productionSources.length).toBeGreaterThan(50);
    expect(Object.keys(sources)).toContain(INJECTION_FILE);
  });

  it("uses dangerouslySetInnerHTML in markdown-preview.tsx only", () => {
    expect(filesMatching(/dangerouslySetInnerHTML/)).toEqual([INJECTION_FILE]);
  });

  it("also forbids the other ways to inject markup", () => {
    expect(
      filesMatching(/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML/),
    ).toEqual([]);
  });

  it("imports markdown-it only in render-markdown.ts and dompurify only in the two sanitisers", () => {
    expect(filesMatching(importOf("markdown-it"))).toEqual([RENDERER_FILE]);
    expect(filesMatching(importOf("dompurify")).sort()).toEqual(
      [SANITIZER_FILE, SVG_SANITIZER_FILE].sort(),
    );
  });

  it("keeps the rendering libraries out of the domain and application layers", () => {
    const offenders = productionSources
      .filter(
        ([file]) =>
          file.startsWith("/src/domain/") ||
          file.startsWith("/src/application/"),
      )
      .filter(
        ([, source]) =>
          importOf("dompurify").test(source) ||
          importOf("markdown-it").test(source),
      );
    expect(offenders).toEqual([]);
  });

  it("detects the patterns it guards", () => {
    expect(/dangerouslySetInnerHTML/.test("x dangerouslySetInnerHTML y")).toBe(
      true,
    );
    expect(importOf("dompurify").test('import a from "dompurify"')).toBe(true);
    expect(
      importOf("markdown-it").test("import a from 'markdown-it/lib/x'"),
    ).toBe(true);
  });
});
