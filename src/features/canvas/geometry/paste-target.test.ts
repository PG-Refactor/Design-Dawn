import { describe, expect, it } from "vitest";
import type { ClipboardContent } from "../../../application/clipboard/clipboard";
import {
  DOCUMENT_ID,
  SHEET_ID,
  size,
} from "../../../application/test-support/fakes";
import { pasteTarget } from "./paste-target";

const VISIBLE = { x: 1000, y: 500, width: 800, height: 600 };

function content(pasteCount: number): ClipboardContent {
  return {
    source: {
      documentId: DOCUMENT_ID,
      sheetId: SHEET_ID,
      origin: { x: 100, y: 50 },
    },
    pasteCount,
    // Bounding box 150 x 90.
    blocks: [
      {
        kind: "text",
        blockType: "markdown",
        size: size(100, 50),
        offset: { x: 0, y: 0 },
        text: "",
      },
      {
        kind: "text",
        blockType: "markdown",
        size: size(50, 50),
        offset: { x: 100, y: 40 },
        text: "",
      },
    ],
  };
}

describe("pasteTarget", () => {
  it("same sheet: steps by the paste offset for each earlier paste", () => {
    const targets = [0, 1, 2].map((count) =>
      pasteTarget({
        content: content(count),
        sameSheet: true,
        visible: VISIBLE,
      }),
    );
    expect(targets.map((target) => target.ok && target.value)).toEqual([
      { x: 124, y: 74 },
      { x: 148, y: 98 },
      { x: 172, y: 122 },
    ]);
  });

  it("other sheet: centres the bounding box in the visible rectangle and ignores pasteCount", () => {
    const first = pasteTarget({
      content: content(0),
      sameSheet: false,
      visible: VISIBLE,
    });
    const later = pasteTarget({
      content: content(5),
      sameSheet: false,
      visible: VISIBLE,
    });
    // (800 - 150) / 2 = 325, (600 - 90) / 2 = 255.
    expect(first.ok && first.value).toEqual({ x: 1325, y: 755 });
    expect(later).toEqual(first);
  });

  it("rounds a fractional centre to integers", () => {
    const result = pasteTarget({
      content: content(0),
      sameSheet: false,
      visible: { x: 0.4, y: -0.6, width: 801, height: 601 },
    });
    // (0.4 + 325.5) = 325.9 -> 326; (-0.6 + 255.5) = 254.9 -> 255.
    expect(result.ok && result.value).toEqual({ x: 326, y: 255 });
  });

  it("rejects a target outside the coordinate range", () => {
    const result = pasteTarget({
      content: content(0),
      sameSheet: false,
      visible: { x: 1e12, y: 0, width: 800, height: 600 },
    });
    expect(result.ok).toBe(false);
  });

  it("other sheet: puts a group larger than the view at the view's top-left corner", () => {
    const target = pasteTarget({
      content: content(0),
      sameSheet: false,
      visible: { x: 0, y: 0, width: 120, height: 60 },
    });
    expect(target.ok && target.value).toEqual({ x: 0, y: 0 });
  });
});
