// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { TextClipboardBlock } from "../../application/clipboard/clipboard";
import {
  type ContentPath,
  parseContentPath,
} from "../../domain/block/content-path";
import { unwrap } from "../../domain/shared/test-support";
import { markdownAssetReferences } from "./markdown-asset-references";

const path = (value: string): ContentPath => unwrap(parseContentPath(value));

function block(
  text: string,
  overrides: Partial<TextClipboardBlock> = {},
): TextClipboardBlock {
  return {
    kind: "text",
    blockType: "markdown",
    text,
    sourceContentPath: path("sheets/s/blocks/markdown-1.md"),
    size: { width: 100, height: 100 } as TextClipboardBlock["size"],
    offset: { x: 0, y: 0 },
    ...overrides,
  };
}

describe("markdownAssetReferences.find", () => {
  it("finds each asset image once, not images in code or other places", () => {
    const text = [
      "![a](../../../assets/a.png) ![again](../../../assets/a.png)",
      "![b](<../../../assets/b c.png>)",
      "`![code](../../../assets/code.png)`",
      "![remote](https://example.com/x.png)",
      "[link](../../../assets/link.png)",
    ].join("\n\n");
    expect(markdownAssetReferences.find(block(text))).toEqual([
      "assets/a.png",
      "assets/b c.png",
    ]);
  });

  it("finds nothing in a Mermaid block or a text without a source file", () => {
    const text = "![a](../../../assets/a.png)";
    expect(
      markdownAssetReferences.find(block(text, { blockType: "mermaid" })),
    ).toEqual([]);
    expect(
      markdownAssetReferences.find(
        block(text, { sourceContentPath: undefined }),
      ),
    ).toEqual([]);
  });
});

describe("markdownAssetReferences.rewrite", () => {
  it("points every destination of a renamed asset at the new name", () => {
    const text =
      '![a](../../../assets/a.png "title") and ![a2](<../../../assets/a.png>) and ![b](../../../assets/b.png)';
    const renamed = new Map([[path("assets/a.png"), path("assets/a-2.png")]]);
    expect(markdownAssetReferences.rewrite(block(text), renamed)).toBe(
      '![a](../../../assets/a-2.png "title") and ![a2](../../../assets/a-2.png) and ![b](../../../assets/b.png)',
    );
  });
});
