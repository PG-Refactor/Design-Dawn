import { describe, expect, it } from "vitest";
import type { RawBlock } from "../../domain/block/block";
import { unwrap } from "../../domain/shared/test-support";
import { parseSheet } from "../../domain/sheet/sheet";
import type { GitSheetVersion } from "../ports/git-gateway";
import { blockToReveal, compareSheetVersions } from "./sheet-comparison";

const SHEET_ID = "01928f3a-7d8e-7f90-b123-456789abcdef";
const ID = (n: number) => `01928f3a-8e9f-7a01-8234-56789abcdef${n}`;
const textPath = (n: number) => `sheets/s/blocks/markdown-${n}.md`;

function block(n: number, extra: Partial<RawBlock> = {}): RawBlock {
  return {
    blockId: ID(n),
    blockType: "markdown",
    position: { x: n * 100, y: 0 },
    size: { width: 80, height: 40 },
    contentPath: textPath(n),
    ...extra,
  };
}

function version(
  blocks: RawBlock[],
  texts: Record<string, string>,
): GitSheetVersion {
  return {
    sheet: unwrap(
      parseSheet({ schemaVersion: 2, sheetId: SHEET_ID, name: "S", blocks }),
    ),
    texts,
    images: {},
  };
}

describe("compareSheetVersions", () => {
  it("tells added, removed, moved and changed Blocks apart", () => {
    const before = version([block(1), block(2), block(3), block(4)], {
      [textPath(1)]: "same",
      [textPath(2)]: "old",
      [textPath(3)]: "x",
      [textPath(4)]: "y",
    });
    const after = version(
      [block(1), block(2), block(3, { position: { x: 999, y: 5 } }), block(5)],
      {
        [textPath(1)]: "same",
        [textPath(2)]: "new",
        [textPath(3)]: "x",
        [textPath(5)]: "z",
      },
    );
    const comparison = compareSheetVersions(before, after);
    const kinds = Object.fromEntries(
      comparison.changes.map((change) => [change.blockId, change]),
    );
    expect(kinds[ID(1)]).toBeUndefined();
    expect(kinds[ID(2)]).toMatchObject({ kind: "changed", content: true });
    expect(kinds[ID(3)]).toMatchObject({ kind: "changed", moved: true });
    expect(kinds[ID(5)]?.kind).toBe("added");
    expect(kinds[ID(4)]?.kind).toBe("removed");
    expect(comparison.counts).toEqual({
      added: 1,
      removed: 1,
      moved: 1,
      changed: 1,
    });
  });

  it("marks only the Block brought to the front, not the ones it passed", () => {
    const before = version([block(1), block(2), block(3), block(4)], {});
    const after = version([block(2), block(3), block(4), block(1)], {});
    const changed = compareSheetVersions(before, after).changes.map(
      (change) => change.blockId,
    );
    expect(changed).toEqual([ID(1)]);
  });

  it("sees display, caption and stacking order changes", () => {
    const before = version([block(1), block(2)], {});
    const after = version(
      [block(2), block(1, { contentScalePercent: 150 })],
      {},
    );
    const changes = compareSheetVersions(before, after).changes;
    // Two Blocks that swap places: one of them is the one that moved in the order.
    expect(changes.find((change) => change.blockId === ID(1))).toMatchObject({
      display: true,
    });
    expect(changes.filter((change) => change.order)).toHaveLength(1);
  });

  it("treats a whole Sheet as added or removed when one side has none", () => {
    const sheet = version([block(1)], {});
    expect(compareSheetVersions(null, sheet).counts.added).toBe(1);
    expect(compareSheetVersions(sheet, null).counts.removed).toBe(1);
  });
});

describe("blockToReveal", () => {
  it("is the Block showing the changed file, else the first changed one", () => {
    const before = version([block(1), block(2)], { [textPath(2)]: "a" });
    const after = version([block(1), block(2)], { [textPath(2)]: "b" });
    const comparison = compareSheetVersions(before, after);
    expect(blockToReveal(comparison, after.sheet, textPath(1))).toBe(ID(1));
    expect(blockToReveal(comparison, after.sheet, null)).toBe(ID(2));
    expect(blockToReveal(comparison, null, textPath(1))).toBeNull();
  });
});

describe("comparison edges", () => {
  it("is null when only removals changed, and marks the one Block that moved to the front", () => {
    const before = version([block(1), block(2), block(3)], {});
    const removedOnly = compareSheetVersions(before, version([block(1)], {}));
    expect(
      blockToReveal(removedOnly, version([block(1)], {}).sheet, null),
    ).toBeNull();
    const toFront = compareSheetVersions(
      before,
      version([block(2), block(3), block(1)], {}),
    );
    expect(
      toFront.changes
        .filter((change) => change.order)
        .map((change) => change.blockId),
    ).toEqual([ID(1)]);
  });
});
