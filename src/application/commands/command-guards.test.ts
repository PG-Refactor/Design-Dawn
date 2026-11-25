import { describe, expect, it } from "vitest";
import { blockDisplayOf } from "../../domain/block/content-scale";
import { parseDisplayName } from "../../domain/shared/display-name";
import { unwrap } from "../../domain/shared/test-support";
import { ALWAYS_ENABLED_AUTO_SAVE_POLICY } from "../ports/auto-save-policy";
import {
  blockIdOf,
  makeBlockAt,
  makeDocumentData,
  OTHER_SHEET_ID,
  position,
  SHEET_ID,
  sheetIdOf,
} from "../test-support/fakes";
import { withSheetAdded, withSheetRemoved } from "../workspace/sheet-structure";
import {
  moveBlocksCommand,
  reorderBlocksCommand,
  setBlockCaptionCommand,
  setBlockDisplayCommand,
} from "./block-commands";
import { editBlockContentCommand } from "./content-commands";
import { updateDocument, withContentPath, withContents } from "./document-data";
import { moveSheetCommand, renameDocumentCommand } from "./naming-commands";

const DATA = makeDocumentData([makeBlockAt(1)]);
const FIRST = blockIdOf(1);

describe("a command reverted before it ran", () => {
  it.each([
    [
      "moveBlocks",
      moveBlocksCommand(SHEET_ID, [
        { blockId: FIRST, position: position(1, 1) },
      ]),
    ],
    ["setBlockCaption", setBlockCaptionCommand(SHEET_ID, FIRST, null)],
    [
      "setBlockDisplay",
      setBlockDisplayCommand(SHEET_ID, FIRST, blockDisplayOf(makeBlockAt(1))),
    ],
    [
      "reorderBlocks",
      reorderBlocksCommand(SHEET_ID, [FIRST], "front" as never),
    ],
    ["renameDocument", renameDocumentCommand(unwrap(parseDisplayName("New")))],
    ["moveSheet", moveSheetCommand(SHEET_ID, null)],
  ])("%s is not applied", (_kind, command) => {
    expect(command.revert(DATA).ok).toBe(false);
  });

  it("moving an unknown sheet is refused", () => {
    expect(moveSheetCommand(sheetIdOf(99), null).apply(DATA).ok).toBe(false);
  });
});

describe("document data", () => {
  it("leaves the data as it is for an unknown block and an unchanged text", () => {
    expect(withContentPath(DATA, blockIdOf(9), "x.md" as never)).toBe(DATA);
    const withText = withContents(DATA, [[FIRST, "a"]]);
    expect(withContents(withText, [[FIRST, "a"]])).toBe(withText);
  });

  it("passes on a refused document update", () => {
    expect(
      updateDocument(DATA, () => ({
        ok: false,
        error: { kind: "invalidDisplayName", detail: "no" },
      })).ok,
    ).toBe(false);
  });
});

describe("sheet structure", () => {
  it("refuses a sheet that is already there, and one the order cannot take", () => {
    const sheet = DATA.sheets.get(SHEET_ID);
    if (sheet === undefined) throw new Error("no sheet");
    expect(withSheetAdded(DATA, sheet).ok).toBe(false);
    const orphan = { ...DATA, sheets: new Map() };
    expect(withSheetAdded(orphan, sheet).ok).toBe(false);
  });

  it("removes a sheet the order does not list", () => {
    expect(withSheetRemoved(DATA, sheetIdOf(42)).document).toBe(DATA.document);
    expect(
      withSheetRemoved(DATA, OTHER_SHEET_ID).document.sheetOrder,
    ).not.toContain(OTHER_SHEET_ID);
  });
});

describe("editing a text", () => {
  it("refuses to put the text back once it is no longer loaded", () => {
    const loaded = withContents(DATA, [[FIRST, "before"]]);
    const command = editBlockContentCommand({
      sheetId: SHEET_ID,
      blockId: FIRST,
      text: "after",
    });
    const applied = command.apply(loaded);
    expect(applied.ok).toBe(true);
    expect(command.revert(DATA).ok).toBe(false);
  });
});

describe("the always-on auto-save policy", () => {
  it("has nothing to unsubscribe", () => {
    const unsubscribe = ALWAYS_ENABLED_AUTO_SAVE_POLICY.subscribe(() => {});
    expect(unsubscribe()).toBeUndefined();
    expect(ALWAYS_ENABLED_AUTO_SAVE_POLICY.isEnabled()).toBe(true);
  });
});
