import { describe, expect, it } from "vitest";

// Security rules for image assets as source checks. Like the other
// guards this reads source text, so it cannot see indirect use; tests and test support are
// excluded because they name the patterns.
const sources = import.meta.glob("/src/features/image/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const productionSources = Object.entries(sources).filter(
  ([file]) => !/\.test\.tsx?$/.test(file) && !file.includes("/test-support/"),
);

const FORBIDDEN_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  {
    name: "innerHTML / outerHTML",
    pattern: /\.(?:inner|outer)HTML|insertAdjacentHTML/,
  },
  { name: "dangerouslySetInnerHTML", pattern: /dangerouslySetInnerHTML/ },
  { name: "DOMParser", pattern: /DOMParser/ },
  { name: "fetch(", pattern: /\bfetch\s*\(/ },
  { name: "XMLHttpRequest", pattern: /XMLHttpRequest/ },
  { name: "createContextualFragment", pattern: /createContextualFragment/ },
];
const IMPORT_SPECIFIER_PATTERN = /\bfrom\s*["']([^"']+)["']/g;

describe("image feature security guard", () => {
  it("scans the image feature sources", () => {
    expect(productionSources.length).toBeGreaterThanOrEqual(2);
    expect(
      productionSources.some(([file]) => file.endsWith("image-block.tsx")),
    ).toBe(true);
  });

  it("never injects markup, parses markup or fetches asset content", () => {
    const violations = productionSources.flatMap(([file, source]) =>
      FORBIDDEN_PATTERNS.filter(({ pattern }) => pattern.test(source)).map(
        ({ name }) => `${file}: ${name}`,
      ),
    );
    expect(violations).toEqual([]);
  });

  it("does not import infrastructure or Tauri", () => {
    const violations = productionSources.flatMap(([file, source]) =>
      [...source.matchAll(IMPORT_SPECIFIER_PATTERN)]
        .map((match) => match[1] ?? "")
        .filter(
          (specifier) =>
            specifier.includes("/infrastructure/") ||
            specifier.startsWith("@tauri-apps"),
        )
        .map((specifier) => `${file} imports ${specifier}`),
    );
    expect(violations).toEqual([]);
  });

  it("detects the patterns it guards", () => {
    for (const { pattern } of FORBIDDEN_PATTERNS) {
      expect(pattern.source.length).toBeGreaterThan(0);
    }
    expect(FORBIDDEN_PATTERNS[3]?.pattern.test("await fetch(url)")).toBe(true);
    expect(FORBIDDEN_PATTERNS[0]?.pattern.test("el.innerHTML = x")).toBe(true);
  });
});
