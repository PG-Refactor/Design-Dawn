import { describe, expect, it } from "vitest";
import { settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import { openedCanvasHarness } from "../canvas/test-support/canvas-harness";
import { getSelection } from "../workspace/ui-state/ui-state";

const VIEW = { viewportSize: { width: 800, height: 600 } };

async function harness() {
  const opened = await openedCanvasHarness();
  await opened.canvasActions.loadSheetContents({
    documentId: DOCUMENT_A,
    sheetId: SHEET_A1,
  });
  await settle();
  return opened;
}

describe("custom templates", () => {
  it("saves a text block as a template of its kind and lists it", async () => {
    const opened = await harness();
    const [first] = opened.blocksOfSheetA1();
    if (first === undefined) throw new Error("a seeded block");
    const saved = await opened.services.templates.saveBlock(
      DOCUMENT_A,
      SHEET_A1,
      first.blockId,
      "global",
      "My note",
    );
    expect(saved.ok).toBe(true);
    const [stored] = opened.templateGateway.stored;
    expect(stored?.summary).toMatchObject({
      scope: "global",
      kind: "markdown",
      name: "My note",
    });
    expect(stored?.content.block?.text).toBe(
      opened.session.getState().contents.get(first.blockId),
    );
    expect(
      opened.services.templates.store.getState().templates.map((t) => t.name),
    ).toEqual(["My note"]);
  });

  it("adds a block from a template where a new block goes, as one undo step", async () => {
    const opened = await harness();
    const [first] = opened.blocksOfSheetA1();
    if (first === undefined) throw new Error("a seeded block");
    await opened.services.templates.saveBlock(
      DOCUMENT_A,
      SHEET_A1,
      first.blockId,
      "shared",
      "Note",
    );
    const template = opened.services.templates.store.getState().templates[0];
    if (template === undefined) throw new Error("listed");
    const before = opened.blocksOfSheetA1().length;
    const depth = await opened.undoDepth();
    const added = await opened.services.templates.addBlocks(
      template,
      DOCUMENT_A,
      SHEET_A1,
      VIEW,
    );
    expect(added.ok).toBe(true);
    expect(opened.blocksOfSheetA1()).toHaveLength(before + 1);
    expect(await opened.undoDepth()).toBe(depth + 1);
  });

  it("makes a new sheet from a sheet template with its blocks and images", async () => {
    const opened = await harness();
    await opened.services.templates.saveSheet(
      DOCUMENT_A,
      SHEET_A1,
      "project",
      "Layout",
    );
    const template = opened.services.templates.store.getState().templates[0];
    if (template === undefined) throw new Error("listed");
    const blocksBefore = opened.blocksOfSheetA1().length;
    const created = await opened.services.templates.createSheet(
      template,
      DOCUMENT_A,
    );
    expect(created.ok).toBe(true);
    const sheetId = opened.uiStateStore
      .getState()
      .activeSheetIdByDocument.get(DOCUMENT_A);
    expect(sheetId).not.toBe(SHEET_A1);
    const sheet =
      sheetId === undefined
        ? undefined
        : opened.session.getState().sheets.get(sheetId);
    expect(sheet?.blocks).toHaveLength(blocksBefore);
    // Same layout as the original sheet.
    expect(sheet?.blocks.map((block) => block.position)).toEqual(
      opened.blocksOfSheetA1().map((block) => block.position),
    );
    // A sheet just made starts with nothing selected.
    expect(
      sheetId === undefined
        ? []
        : [...getSelection(opened.uiStateStore.getState(), sheetId)],
    ).toEqual([]);
  });

  it("renames, moves and deletes a template, keeping the list current", async () => {
    const opened = await harness();
    const [first] = opened.blocksOfSheetA1();
    if (first === undefined) throw new Error("a seeded block");
    await opened.services.templates.saveBlock(
      DOCUMENT_A,
      SHEET_A1,
      first.blockId,
      "project",
      "Old",
    );
    const templates = opened.services.templates;
    const template = templates.store.getState().templates[0];
    if (template === undefined) throw new Error("listed");
    await templates.rename(template, "New");
    expect(templates.store.getState().templates[0]?.name).toBe("New");
    await templates.move(template, "shared");
    expect(templates.store.getState().templates[0]?.scope).toBe("shared");
    await templates.remove({ ...template, scope: "shared" });
    expect(templates.store.getState().templates).toEqual([]);
  });
});

describe("a Document from a template", () => {
  it("is saved complete, imports each image once, and starts with no history", async () => {
    const opened = await harness();
    await opened.services.templates.saveDocument(DOCUMENT_A, "project", "Doc");
    const template = opened.services.templates.store.getState().templates[0];
    if (template === undefined) throw new Error("listed");
    // Two sheets that show the same image.
    const stored = opened.templateGateway.stored[0];
    if (stored === undefined) throw new Error("stored");
    const [sheet] = stored.content.sheets;
    if (sheet === undefined) throw new Error("a sheet");
    const imageBlock = {
      blockType: "image",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      asset: "pixel.png",
    };
    opened.templateGateway.stored[0] = {
      ...stored,
      content: {
        ...stored.content,
        sheets: [
          { sheetName: "One", blocks: [...sheet.blocks, imageBlock] },
          { sheetName: "Two", blocks: [...sheet.blocks, imageBlock] },
        ],
        assets: ["pixel.png"],
      },
    };
    const created = await opened.services.templates.createDocument(
      template,
      "From template",
      null,
    );
    expect(created.ok).toBe(true);
    const documentId = opened.uiStateStore.getState().activeDocumentId;
    if (documentId === null) throw new Error("shown");
    expect(
      opened.templateGateway.imported.filter(
        (entry) => entry.documentId === documentId,
      ),
    ).toEqual([{ documentId, assetName: "pixel.png" }]);
    const state = opened.services.applicationStore
      .getState()
      .documents.get(documentId);
    expect(state?.sheets.size).toBe(2);
    expect(state?.save.documentDirty).toBe(false);
    expect(state?.save.dirtySheetIds.size).toBe(0);
    expect(state?.save.dirtyContentBlockIds.size).toBe(0);
    expect(state?.history.canUndo).toBe(false);
  });
});
