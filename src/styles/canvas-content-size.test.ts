import { describe, expect, it } from "vitest";

// The UI text size setting changes the root rem. Block content has a fixed size in the
// Document, so its stylesheets size things with `--content-rem` (pinned on the canvas)
// instead of rem, or a viewer's setting would make text overflow its block.
const CONTENT_STYLESHEETS = import.meta.glob(
  [
    "/src/features/canvas/block-frame.css",
    "/src/features/markdown/markdown-preview.css",
    "/src/features/text-block/*.css",
    "/src/features/image/image-block.css",
    "/src/features/mermaid/mermaid-diagram-preview.css",
    "/src/features/mermaid/diagram-gui.css",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const CANVAS_STYLESHEET = import.meta.glob("/src/features/canvas/canvas.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const REM_PATTERN = /(?<![\w-])\d*\.?\d+rem\b/g;
const COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;

describe("canvas content size", () => {
  it("finds the block content stylesheets", () => {
    expect(Object.keys(CONTENT_STYLESHEETS).length).toBe(7);
  });

  it("sizes block content with --content-rem, never with rem", () => {
    const offenders = Object.entries(CONTENT_STYLESHEETS).flatMap(
      ([file, source]) =>
        (source.replace(COMMENT_PATTERN, "").match(REM_PATTERN) ?? []).map(
          (length) => `${file}: ${length}`,
        ),
    );
    expect(offenders).toEqual([]);
  });

  it("pins --content-rem, the spacing tokens and the font size on the canvas world", () => {
    const source = Object.values(CANVAS_STYLESHEET)[0] ?? "";
    const world = /\.canvas__world\s*\{([^}]*)\}/.exec(source)?.[1] ?? "";
    expect(world).toContain("--content-rem: var(--canvas-content-rem);");
    expect(world).toContain("font-size: var(--content-rem);");
    for (const token of ["--space-1", "--space-2", "--space-3", "--space-4"]) {
      expect(world).toContain(`${token}:`);
    }
  });
});
