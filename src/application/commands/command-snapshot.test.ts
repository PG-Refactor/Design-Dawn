import { describe, expect, it } from "vitest";
import { parseCaption } from "../../domain/block/caption";
import {
  blockIdOf,
  displayName,
  makeBlockAt,
  makeDocumentData,
  OTHER_SHEET_ID,
  position,
  SHEET_ID,
  size,
} from "../test-support/fakes";
import {
  moveBlocksCommand,
  reorderBlocksCommand,
  resizeBlocksCommand,
  setBlockCaptionCommand,
} from "./block-commands";
import { COMMAND_KINDS } from "./command-kind";

// createBlocks / deleteBlocks are data already (file-backed), not metadata commands.
const FILE_BACKED_KINDS = 2;

function unwrapCaption(result: ReturnType<typeof parseCaption>) {
  if (!result.ok) throw new Error(result.error.detail);
  return result.value;
}

import type { MetadataCommand } from "./command";
import {
  commandFromSnapshot,
  type MetadataCommandSnapshot,
} from "./command-snapshot";
import { editBlockContentCommand } from "./content-commands";
import type { DocumentData } from "./document-data";
import {
  moveSheetCommand,
  renameDocumentCommand,
  renameSheetCommand,
} from "./naming-commands";

const FIRST = blockIdOf(1);
const SECOND = blockIdOf(2);

function startData(): DocumentData {
  const data = makeDocumentData([
    makeBlockAt(1, 10, 20),
    makeBlockAt(2, 300, 40),
  ]);
  return { ...data, contents: new Map([[FIRST, "before"]]) };
}

function unwrapData(
  result: ReturnType<MetadataCommand["apply"]>,
): DocumentData {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

// What another window receives: the snapshot as JSON text, read back.
function throughJson(
  snapshot: MetadataCommandSnapshot,
): MetadataCommandSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as MetadataCommandSnapshot;
}

const COMMANDS: readonly (readonly [string, () => MetadataCommand])[] = [
  [
    "moveBlocks",
    () =>
      moveBlocksCommand(SHEET_ID, [
        { blockId: FIRST, position: position(50, 60) },
      ]),
  ],
  [
    "resizeBlocks",
    () =>
      resizeBlocksCommand(SHEET_ID, [
        { blockId: SECOND, position: position(1, 2), size: size(90, 80) },
      ]),
  ],
  ["reorderBlocks", () => reorderBlocksCommand(SHEET_ID, [FIRST], "toFront")],
  ["renameSheet", () => renameSheetCommand(SHEET_ID, displayName("Renamed"))],
  ["renameDocument", () => renameDocumentCommand(displayName("New name"))],
  ["moveSheet", () => moveSheetCommand(OTHER_SHEET_ID, SHEET_ID)],
  [
    "setBlockCaption",
    () =>
      setBlockCaptionCommand(SHEET_ID, FIRST, {
        text: unwrapCaption(parseCaption("Figure 1: flow")),
        position: "above",
      }),
  ],
  [
    "editBlockContent",
    () =>
      editBlockContentCommand({
        sheetId: SHEET_ID,
        blockId: FIRST,
        text: "after",
      }),
  ],
];

describe("commandFromSnapshot", () => {
  it.each(COMMANDS)(
    "rebuilds %s after JSON, undoing and redoing like the original",
    (kind, create) => {
      const before = startData();
      const original = create();
      const after = unwrapData(original.apply(before));
      expect(after).not.toBe(before);

      const rebuilt = commandFromSnapshot(throughJson(original.snapshot()));
      expect(rebuilt.kind).toBe(kind);
      // Undo in the other window restores exactly what the original would.
      const undone = unwrapData(rebuilt.revert(after));
      expect(undone).toEqual(unwrapData(original.revert(after)));
      expect(undone.document).toEqual(before.document);
      expect([...undone.sheets.values()]).toEqual([...before.sheets.values()]);
      expect([...undone.contents]).toEqual([...before.contents]);
      // Redo there gives the same result as here.
      expect(unwrapData(rebuilt.apply(undone))).toEqual(after);
      // And it snapshots the same again.
      expect(rebuilt.snapshot()).toEqual(original.snapshot());
    },
  );

  it("covers every kind of metadata command", () => {
    expect(new Set(COMMANDS.map(([kind]) => kind)).size).toBe(
      Object.keys(COMMAND_KINDS).length - FILE_BACKED_KINDS,
    );
  });

  it("keeps an unapplied command unapplied (nothing captured to revert)", () => {
    const original = renameSheetCommand(SHEET_ID, displayName("Renamed"));
    const rebuilt = commandFromSnapshot(throughJson(original.snapshot()));
    expect(rebuilt.revert(startData()).ok).toBe(false);
  });
});
