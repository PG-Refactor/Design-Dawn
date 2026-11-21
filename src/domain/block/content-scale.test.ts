import { describe, expect, it } from "vitest";
import { unwrap } from "../shared/test-support";
import { parseSheet, setBlockDisplay } from "../sheet/sheet";
import { type Block, parseBlock, type RawBlock } from "./block";
import {
  blockDisplayOf,
  displayFields,
  parseContentScalePercent,
  steppedScalePercent,
} from "./content-scale";

const SHEET_ID = "01928f3a-7d8e-7f90-b123-456789abcdef";
const MARKDOWN_ID = "01928f3a-8e9f-7a01-8234-56789abcdef0";
const MERMAID_ID = "01928f3a-8e9f-7a01-8234-56789abcdef1";
const IMAGE_ID = "01928f3a-8e9f-7a01-8234-56789abcdef2";

function raw(blockType: string, blockId: string, extra = {}): RawBlock {
  return {
    blockId,
    blockType,
    position: { x: 0, y: 0 },
    size: { width: 100, height: 80 },
    contentPath:
      blockType === "image"
        ? "assets/pic.png"
        : `sheets/s/blocks/${blockType}-1.${blockType === "mermaid" ? "mmd" : "md"}`,
    ...extra,
  };
}

function blockAt(sheet: { readonly blocks: readonly Block[] }, index: number) {
  const block = sheet.blocks[index];
  if (block === undefined) throw new Error(`no block ${index}`);
  return block;
}

function sheetOf(...blocks: RawBlock[]) {
  return unwrap(
    parseSheet({ schemaVersion: 1, sheetId: SHEET_ID, name: "S", blocks }),
  );
}

describe("content scale", () => {
  it("is an integer percent from 25 to 400", () => {
    expect(parseContentScalePercent(25).ok).toBe(true);
    expect(parseContentScalePercent(400).ok).toBe(true);
    for (const bad of [24, 401, 150.5, Number.NaN]) {
      const result = parseContentScalePercent(bad);
      expect(!result.ok && result.error.kind).toBe("invalidContentScale");
    }
  });

  it("steps by 10 to the next multiple, inside the bounds", () => {
    expect(steppedScalePercent(100, 1)).toBe(110);
    expect(steppedScalePercent(100, -1)).toBe(90);
    expect(steppedScalePercent(83, 1)).toBe(90);
    expect(steppedScalePercent(83, -1)).toBe(80);
    expect(steppedScalePercent(25, 1)).toBe(30);
    expect(steppedScalePercent(30, -1)).toBe(25);
    expect(steppedScalePercent(25, -1)).toBe(25);
    expect(steppedScalePercent(400, 1)).toBe(400);
  });

  it("fills in the defaults: diagrams fit, text does not, both at 100%", () => {
    const markdown = unwrap(parseBlock(raw("markdown", MARKDOWN_ID)));
    const mermaid = unwrap(parseBlock(raw("mermaid", MERMAID_ID)));
    expect(blockDisplayOf(markdown)).toEqual({
      scalePercent: 100,
      autoFit: false,
    });
    expect(blockDisplayOf(mermaid).autoFit).toBe(true);
    expect(displayFields("mermaid", { ...blockDisplayOf(mermaid) })).toEqual(
      {},
    );
  });

  it("is refused on an image and when out of range in the file", () => {
    const onImage = parseBlock(raw("image", IMAGE_ID, { autoFit: true }));
    expect(!onImage.ok && onImage.error.kind).toBe("invalidContentScale");
    const tooLarge = parseBlock(
      raw("markdown", MARKDOWN_ID, { contentScalePercent: 500 }),
    );
    expect(!tooLarge.ok && tooLarge.error.kind).toBe("invalidContentScale");
  });
});

describe("setBlockDisplay", () => {
  it("keeps only what differs from the default, and nothing when back to it", () => {
    const sheet = sheetOf(
      raw("markdown", MARKDOWN_ID),
      raw("mermaid", MERMAID_ID),
    );
    const scaled = unwrap(
      setBlockDisplay(sheet, blockAt(sheet, 0).blockId, {
        scalePercent: steppedScalePercent(140, 1),
        autoFit: true,
      }),
    );
    expect(blockAt(scaled, 0)).toMatchObject({
      contentScalePercent: 150,
      autoFit: true,
    });
    const back = unwrap(
      setBlockDisplay(scaled, blockAt(sheet, 0).blockId, {
        scalePercent: steppedScalePercent(110, -1),
        autoFit: false,
      }),
    );
    expect(blockAt(back, 0)).toEqual(blockAt(sheet, 0));
    // A diagram that should not fit says so.
    const unfit = unwrap(
      setBlockDisplay(sheet, blockAt(sheet, 1).blockId, {
        scalePercent: steppedScalePercent(110, -1),
        autoFit: false,
      }),
    );
    expect(blockAt(unfit, 1).autoFit).toBe(false);
  });

  it("returns the same sheet when nothing changes and refuses an image", () => {
    const sheet = sheetOf(raw("markdown", MARKDOWN_ID), raw("image", IMAGE_ID));
    const same = unwrap(
      setBlockDisplay(
        sheet,
        blockAt(sheet, 0).blockId,
        blockDisplayOf(blockAt(sheet, 0)),
      ),
    );
    expect(same).toBe(sheet);
    const image = setBlockDisplay(sheet, blockAt(sheet, 1).blockId, {
      scalePercent: steppedScalePercent(100, 1),
      autoFit: false,
    });
    expect(!image.ok && image.error.kind).toBe("invalidContentScale");
  });
});
