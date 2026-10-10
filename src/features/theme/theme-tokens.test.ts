import { describe, expect, it } from "vitest";
import { THEME_DEFINITIONS } from "../../application/local-state/theme";
import { THEME_ATTRIBUTE_NAME } from "./apply-theme";
import {
  contrastRatio,
  parseHexColor,
  type Rgb,
} from "./test-support/color-contrast";
import {
  COLOR_TOKEN_NAMES,
  SHADOW_TOKEN_NAMES,
  THEME_TOKEN_NAMES,
} from "./theme-tokens";

const TEXT_CONTRAST_MINIMUM = 4.5;
const BLOCK_PATTERN = new RegExp(
  `:root\\[${THEME_ATTRIBUTE_NAME}="([^"]+)"\\]\\s*\\{([^}]*)\\}`,
  "g",
);

function parseThemes(css: string): Map<string, Map<string, string>> {
  const themes = new Map<string, Map<string, string>>();
  for (const block of css.matchAll(BLOCK_PATTERN)) {
    const declarations = new Map<string, string>();
    for (const declaration of (block[2] ?? "").matchAll(
      /([\w-]+)\s*:\s*([^;]+);/g,
    )) {
      declarations.set(declaration[1] ?? "", (declaration[2] ?? "").trim());
    }
    themes.set(block[1] ?? "", declarations);
  }
  return themes;
}

// Read through a glob like the architecture guard does; an empty result would make every
// check below vacuous, so it is asserted first.
const tokenSources = import.meta.glob("../../styles/theme-tokens.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const tokensCss = Object.values(tokenSources)[0] ?? "";
const themes = parseThemes(tokensCss);
const themeIds = THEME_DEFINITIONS.map((definition) => definition.id);

function colorOf(themeId: string, token: string): Rgb {
  const color = parseHexColor(themes.get(themeId)?.get(token) ?? "");
  if (color === null) throw new Error(`${themeId} ${token} is not a colour`);
  return color;
}

const GIT_STATUS_TOKENS = [
  "--color-git-modified",
  "--color-git-added",
  "--color-git-deleted",
  "--color-git-renamed",
  "--color-git-untracked",
  "--color-git-conflict",
] as const;

describe("theme token stylesheet", () => {
  it("is read", () => {
    expect(tokensCss.length).toBeGreaterThan(0);
  });

  it("has exactly one block per theme definition", () => {
    expect([...themes.keys()].sort()).toEqual([...themeIds].sort());
  });

  it.each(themeIds)("%s defines exactly the token set", (themeId) => {
    const names = [...(themes.get(themeId)?.keys() ?? [])].filter((name) =>
      name.startsWith("--"),
    );
    expect(names.sort()).toEqual([...THEME_TOKEN_NAMES].sort());
  });

  it.each(themeIds)("%s sets color-scheme to itself", (themeId) => {
    expect(themes.get(themeId)?.get("color-scheme")).toBe(themeId);
  });

  it.each(themeIds)("%s colour tokens are valid colours", (themeId) => {
    for (const token of COLOR_TOKEN_NAMES) {
      expect(
        parseHexColor(themes.get(themeId)?.get(token) ?? ""),
        token,
      ).not.toBeNull();
    }
    for (const token of SHADOW_TOKEN_NAMES) {
      expect(themes.get(themeId)?.get(token), token).toMatch(/\S/);
    }
  });

  it.each(themeIds)("%s meets WCAG AA contrast", (themeId) => {
    const pairs = [
      ["--color-text", "--color-background"],
      ["--color-text", "--color-surface"],
      ["--color-text-muted", "--color-background"],
      ["--color-text-muted", "--color-surface"],
      ["--color-accent-contrast", "--color-accent"],
      ["--color-danger-contrast", "--color-danger"],
      ["--color-danger", "--color-background"],
      ["--color-danger", "--color-surface"],
      ["--color-warning", "--color-background"],
      ["--color-warning", "--color-surface"],
      ["--color-warning", "--color-surface-raised"],
      ["--color-danger", "--color-surface-raised"],
      ["--color-diff-added-text", "--color-diff-added-bg"],
      ["--color-diff-removed-text", "--color-diff-removed-bg"],
      ["--color-diff-hunk-text", "--color-surface"],
      ["--color-diff-hunk-text", "--color-background"],
      ["--color-diff-meta-text", "--color-surface"],
      ["--color-diff-meta-text", "--color-background"],
      ["--color-text-muted", "--color-diff-filler-bg"],
      ["--color-text", "--color-diff-added-bg"],
      ["--color-text", "--color-diff-removed-bg"],
      ["--color-button-primary-text", "--color-button-primary-bg"],
      ["--color-button-primary-text", "--color-button-primary-hover"],
      ...GIT_STATUS_TOKENS.flatMap((token) => [
        [token, "--color-surface"],
        [token, "--color-background"],
        [token, "--color-selection"],
      ]),
    ] as const;
    for (const [foreground, background] of pairs) {
      const ratio = contrastRatio(
        colorOf(themeId, foreground),
        colorOf(themeId, background),
      );
      expect(
        ratio,
        `${themeId} ${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(TEXT_CONTRAST_MINIMUM);
    }
  });

  it("makes the switch visible: background and text differ between themes", () => {
    const [first, second] = themeIds;
    for (const token of ["--color-background", "--color-text"]) {
      expect(themes.get(first ?? "")?.get(token)).not.toBe(
        themes.get(second ?? "")?.get(token),
      );
    }
  });
});
