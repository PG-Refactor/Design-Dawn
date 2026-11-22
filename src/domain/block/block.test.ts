import { describe, expect, it } from "vitest";
import { unwrap } from "../shared/test-support";
import { parseBlock, type RawBlock } from "./block";

const RAW: RawBlock = {
  blockId: "01928f3a-8e9f-7a01-8234-000000000001",
  blockType: "markdown",
  position: { x: 0, y: 0 },
  size: { width: 100, height: 50 },
  contentPath: "sheets/s/blocks/markdown-1.md",
};

describe("parseBlock", () => {
  it("keeps the optional keys only when they are written", () => {
    expect(Object.keys(unwrap(parseBlock(RAW)))).toEqual([
      "blockId",
      "blockType",
      "position",
      "size",
      "contentPath",
    ]);
    const full = unwrap(
      parseBlock({
        ...RAW,
        caption: "Notes",
        captionPosition: "above",
        contentScalePercent: 150,
        autoFit: true,
      }),
    );
    expect(full).toMatchObject({
      caption: "Notes",
      captionPosition: "above",
      contentScalePercent: 150,
      autoFit: true,
    });
  });

  it.each([
    ["the id", { blockId: "nope" }, "invalidEntityId"],
    ["the type", { blockType: "video" }, "unsupportedBlockType"],
    ["the position", { position: { x: 0.5, y: 0 } }, "invalidPosition"],
    ["the size", { size: { width: 0, height: 1 } }, "invalidSize"],
    ["the content path", { contentPath: "" }, "invalidContentPath"],
    ["the caption", { caption: "" }, "invalidCaption"],
    ["the caption position", { captionPosition: "left" }, "invalidCaption"],
    ["the display size", { contentScalePercent: 1 }, "invalidContentScale"],
  ])("reports %s first when it is wrong", (_what, change, kind) => {
    const parsed = parseBlock({ ...RAW, ...change } as RawBlock);
    expect(!parsed.ok && parsed.error.kind).toBe(kind);
  });

  it("refuses a display size or fitting for an image Block", () => {
    const image = { ...RAW, blockType: "image", contentPath: "assets/a.png" };
    for (const change of [{ contentScalePercent: 150 }, { autoFit: false }]) {
      const parsed = parseBlock({ ...image, ...change });
      expect(!parsed.ok && parsed.error.kind).toBe("invalidContentScale");
    }
  });
});
