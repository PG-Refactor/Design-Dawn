import { describe, expect, it } from "vitest";

// Colours belong in theme-tokens.css only (CLAUDE.md §52). Limits of this guard: it
// reads source text, so it cannot see colours built at run time or named colours inside
// TypeScript style objects; named colours are only checked in CSS declarations and only
// from the list below.
const sources = import.meta.glob("/src/**/*.{ts,tsx,css}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const TOKEN_FILE = "/src/styles/theme-tokens.css";
const COLOR_FUNCTION_PATTERN =
  /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/i;
const HEX_COLOR_PATTERN = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/i;
const COLOR_PROPERTY_PATTERN =
  /(?:^|[;{\s])(?:color|background(?:-color)?|border(?:-[a-z]+)*|outline(?:-color)?|box-shadow|fill|stroke|accent-color|caret-color)\s*:\s*([^;}]+)/gi;
const NAMED_COLORS = [
  "white",
  "black",
  "red",
  "green",
  "blue",
  "yellow",
  "orange",
  "purple",
  "pink",
  "gray",
  "grey",
  "silver",
  "brown",
  "cyan",
  "magenta",
  "navy",
  "teal",
  "lime",
  "maroon",
  "olive",
  "aqua",
  "fuchsia",
  "gold",
  "indigo",
  "violet",
  "crimson",
];
const NAMED_COLOR_PATTERN = new RegExp(
  `\\b(?:${NAMED_COLORS.join("|")})\\b`,
  "i",
);

function stripComments(source: string, isCss: boolean): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return isCss
    ? withoutBlocks
    : withoutBlocks.replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function findColorLiterals(source: string, isCss: boolean): string[] {
  const text = stripComments(source, isCss);
  const found: string[] = [];
  for (const pattern of [COLOR_FUNCTION_PATTERN, HEX_COLOR_PATTERN]) {
    const match = pattern.exec(text);
    if (match !== null) found.push(match[0]);
  }
  if (isCss) {
    for (const declaration of text.matchAll(COLOR_PROPERTY_PATTERN)) {
      // `var(--color-red)` style references are tokens, not literals.
      const value = (declaration[1] ?? "").replace(/var\([^)]*\)/g, "");
      const named = NAMED_COLOR_PATTERN.exec(value);
      if (named !== null) found.push(named[0]);
    }
  }
  return found;
}

describe("no hard-coded colours", () => {
  const scanned = Object.entries(sources).filter(
    ([path]) =>
      path !== TOKEN_FILE &&
      !/\.test\.tsx?$/.test(path) &&
      !path.includes("/test-support/"),
  );

  it("scans the application sources", () => {
    expect(scanned.length).toBeGreaterThan(20);
    expect(scanned.some(([path]) => path.endsWith(".css"))).toBe(true);
    expect(sources[TOKEN_FILE]?.length).toBeGreaterThan(0);
    expect(scanned.every(([, source]) => source.length > 0)).toBe(true);
  });

  it("finds no colour literal outside theme-tokens.css", () => {
    const violations = scanned.flatMap(([path, source]) =>
      findColorLiterals(source, path.endsWith(".css")).map(
        (literal) => `${path}: ${literal}`,
      ),
    );
    expect(violations).toEqual([]);
  });

  it("detects the literals it is meant to catch", () => {
    expect(findColorLiterals("a { color: #fff; }", true)).not.toEqual([]);
    expect(findColorLiterals("a { color: #ff00aa80; }", true)).not.toEqual([]);
    expect(
      findColorLiterals("a { background: rgb(0 0 0); }", true),
    ).not.toEqual([]);
    expect(findColorLiterals("a { border: 1px solid red; }", true)).not.toEqual(
      [],
    );
    expect(
      findColorLiterals('const c = "hsla(1, 2%, 3%, 1)";', false),
    ).not.toEqual([]);
    expect(findColorLiterals("a { color: var(--color-text); }", true)).toEqual(
      [],
    );
    expect(findColorLiterals("// issue #123 fixed", false)).toEqual([]);
    expect(
      findColorLiterals(
        "a { color: var(--red); background: transparent; }",
        true,
      ),
    ).toEqual([]);
  });
});
