import { describe, expect, it } from "vitest";
import { type Caption, parseCaption } from "../block/caption";
import { keptScalePercent } from "../block/content-scale";
import {
  blockIdOf,
  makeBlockAt,
  makeSheetWith,
  SHEET_ID,
} from "../shared/test-fixtures";
import { unwrap } from "../shared/test-support";
import {
  insertBlocksAt,
  parseSheet,
  removeBlocks,
  setBlockCaption,
  setBlockDisplay,
} from "./sheet";

const CAPTION: Caption = unwrap(parseCaption("Figure"));
const MERMAID = makeBlockAt(1, 0, 0, "mermaid");
const IMAGE = makeBlockAt(2, 0, 0, "image");

function sheetOf() {
  return makeSheetWith(SHEET_ID, [MERMAID, IMAGE]);
}

describe("setBlockCaption", () => {
  it("writes the position only when it is not the default", () => {
    const below = unwrap(
      setBlockCaption(sheetOf(), MERMAID.blockId, {
        text: CAPTION,
        position: "below",
      }),
    );
    expect(below.blocks[0]).toMatchObject({ caption: CAPTION });
    expect(below.blocks[0]).not.toHaveProperty("captionPosition");
    const above = unwrap(
      setBlockCaption(below, MERMAID.blockId, {
        text: CAPTION,
        position: "above",
      }),
    );
    expect(above.blocks[0]).toMatchObject({ captionPosition: "above" });
  });

  it("removes a caption with null, and gives the same sheet when nothing changes", () => {
    const captioned = unwrap(
      setBlockCaption(sheetOf(), IMAGE.blockId, {
        text: CAPTION,
        position: "above",
      }),
    );
    const removed = unwrap(setBlockCaption(captioned, IMAGE.blockId, null));
    expect(removed.blocks[1]).not.toHaveProperty("caption");
    expect(removed.blocks[1]).not.toHaveProperty("captionPosition");
    const sheet = sheetOf();
    expect(unwrap(setBlockCaption(sheet, MERMAID.blockId, null))).toBe(sheet);
  });

  it("refuses a Block that is not on the sheet", () => {
    const result = setBlockCaption(sheetOf(), blockIdOf(9), null);
    expect(!result.ok && result.error.kind).toBe("entityNotFound");
  });
});

describe("setBlockDisplay", () => {
  it("refuses a Block that is not on the sheet, and an image", () => {
    const display = { scalePercent: keptScalePercent(150), autoFit: true };
    const missing = setBlockDisplay(sheetOf(), blockIdOf(9), display);
    expect(!missing.ok && missing.error.kind).toBe("entityNotFound");
    const image = setBlockDisplay(sheetOf(), IMAGE.blockId, display);
    expect(!image.ok && image.error.kind).toBe("invalidContentScale");
  });
});

describe("insertBlocksAt and removeBlocks", () => {
  it("does nothing with nothing to insert or remove", () => {
    const sheet = sheetOf();
    expect(unwrap(insertBlocksAt(sheet, []))).toBe(sheet);
    expect(unwrap(removeBlocks(sheet, []))).toBe(sheet);
  });

  it("puts several Blocks back at their final indexes, in any order given", () => {
    const sheet = makeSheetWith(SHEET_ID, [makeBlockAt(1), makeBlockAt(3)]);
    const restored = unwrap(
      insertBlocksAt(sheet, [
        { block: makeBlockAt(4), index: 4 },
        { block: makeBlockAt(0), index: 0 },
        { block: makeBlockAt(2), index: 2 },
      ]),
    );
    expect(restored.blocks.map((block) => block.blockId)).toEqual(
      [0, 1, 2, 3, 4].map(blockIdOf),
    );
  });

  it("refuses a Block that is already there", () => {
    const result = insertBlocksAt(sheetOf(), [{ block: MERMAID, index: 0 }]);
    expect(!result.ok && result.error.kind).toBe("duplicateId");
  });
});

describe("parseSheet", () => {
  it("reports a bad sheet id", () => {
    const parsed = parseSheet({
      schemaVersion: 1,
      sheetId: "nope",
      name: "Sheet",
      blocks: [],
    });
    expect(!parsed.ok && parsed.error.kind).toBe("invalidEntityId");
  });
});
