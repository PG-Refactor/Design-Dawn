import { describe, expect, it } from "vitest";
import type { ContentPath } from "../../domain/block/content-path";
import { type DocumentData, withContents } from "../commands/document-data";
import { ALWAYS_ENABLED_AUTO_SAVE_POLICY } from "../ports/auto-save-policy";
import {
  blockIdOf,
  createFakeGateway,
  createFakeScheduler,
  DOCUMENT_ID,
  type FakeGateway,
  makeBlockAt,
  makeDocumentData,
  PROJECT_ID,
  SHEET_ID,
  sheetIdOf,
} from "../test-support/fakes";
import { createSaveCoordinator, NO_PLANNED_FILES } from "./save-coordinator";

const BLOCK = makeBlockAt(1, 0, 0);
const NEW_PATH = "sheets/s/blocks/markdown-new.md" as ContentPath;

function coordinator(gateway: FakeGateway, data: DocumentData) {
  const relocated: string[] = [];
  const saver = createSaveCoordinator({
    projectId: PROJECT_ID,
    documentId: DOCUMENT_ID,
    gateway,
    scheduler: createFakeScheduler(),
    autoSaveDelayMs: 1,
    autoSavePolicy: ALWAYS_ENABLED_AUTO_SAVE_POLICY,
    getData: () => data,
    runExclusive: (task) => task(),
    onChange: () => {},
    relocate: (blockId) => relocated.push(blockId),
  });
  return { saver, relocated };
}

const planned = {
  blockId: BLOCK.blockId,
  sheetId: SHEET_ID,
  blockType: "markdown" as const,
  contentPath: NEW_PATH,
};

describe("save coordinator failures", () => {
  const data = withContents(makeDocumentData([BLOCK]), [[BLOCK.blockId, "x"]]);

  it("keeps a planned file that cannot be created, and does not save the sheets after it", async () => {
    const gateway = createFakeGateway();
    gateway.failOn("restoreBlockContent", "ioError");
    const { saver } = coordinator(gateway, data);
    saver.planCreate(planned);
    saver.markDirty({
      documentChanged: false,
      changedSheetIds: [SHEET_ID],
      changedContentBlockIds: [],
    });
    const saved = await saver.saveDirty();
    expect(!saved.ok && saved.error.kind).toBe("ioError");
    expect(saver.plannedFiles().creates).toHaveLength(1);
    expect(gateway.methods()).not.toContain("saveSheet");
  });

  it("keeps a planned file whose taken name cannot be replaced", async () => {
    const gateway = createFakeGateway();
    gateway.failOn("restoreBlockContent", "alreadyExists");
    gateway.failOn("createBlockContent", "ioError");
    const { saver, relocated } = coordinator(gateway, data);
    saver.planCreate(planned);
    saver.markDirty({
      documentChanged: true,
      changedSheetIds: [],
      changedContentBlockIds: [],
    });
    expect((await saver.saveDirty()).ok).toBe(false);
    expect(relocated).toEqual([]);
    expect(saver.plannedFiles().creates).toHaveLength(1);
  });

  it("keeps a planned deletion that fails, and drops one whose file is already gone", async () => {
    const gateway = createFakeGateway();
    gateway.failOn("deleteBlockContent", "ioError");
    const { saver } = coordinator(gateway, data);
    saver.planRemoval(blockIdOf(8), "a.md" as ContentPath);
    saver.markDirty({
      documentChanged: false,
      changedSheetIds: [SHEET_ID],
      changedContentBlockIds: [],
    });
    expect((await saver.saveDirty()).ok).toBe(false);
    expect(saver.plannedFiles().deletes).toEqual(["a.md"]);
    expect((await saver.saveDirty()).ok).toBe(true);
    expect(saver.plannedFiles().deletes).toEqual([]);
  });

  it("forgets dirty texts and sheets that no longer exist", async () => {
    const gateway = createFakeGateway();
    const { saver } = coordinator(gateway, data);
    saver.markDirty({
      documentChanged: false,
      changedSheetIds: [sheetIdOf(60)],
      changedContentBlockIds: [blockIdOf(61)],
    });
    expect((await saver.saveDirty()).ok).toBe(true);
    expect(gateway.methods()).toEqual([]);
    expect(saver.getState().dirtySheetIds.size).toBe(0);
  });
});

describe("save coordinator lifecycle", () => {
  const data = withContents(makeDocumentData([BLOCK]), [[BLOCK.blockId, "x"]]);
  const change = {
    documentChanged: true,
    changedSheetIds: [],
    changedContentBlockIds: [],
  };

  it("ignores everything once disposed", () => {
    const { saver } = coordinator(createFakeGateway(), data);
    saver.dispose();
    saver.markDirty(change);
    saver.suspendSaving({ kind: "ioError", detail: "x" });
    saver.resumeSaving();
    saver.markClean();
    expect(saver.getState().documentDirty).toBe(false);
  });

  it("resumes only a suspension, clears its error and leaves a clean state alone", () => {
    const { saver } = coordinator(createFakeGateway(), data);
    saver.resumeSaving();
    saver.suspendSaving({ kind: "externalChange", detail: "x" } as never);
    saver.markClean();
    saver.resumeSaving();
    expect(saver.getState().lastError).toBeNull();
    saver.markDirty(change);
    saver.suspendSaving({ kind: "ioError", detail: "y" });
    saver.resumeSaving();
    expect(saver.getState().lastError).toBeNull();
  });

  it("plans a restored file again when no deletion was planned for it", () => {
    const { saver } = coordinator(createFakeGateway(), data);
    saver.planRestore(planned);
    expect(saver.plannedFiles().creates).toEqual([planned]);
    saver.planRemoval(planned.blockId, planned.contentPath);
    saver.planRemoval(blockIdOf(9), NEW_PATH);
    saver.planRestore({ ...planned, blockId: blockIdOf(9) });
    expect(saver.plannedFiles()).toEqual(NO_PLANNED_FILES);
  });
});

describe("planned sheet deletions", () => {
  const data = withContents(makeDocumentData([BLOCK]), [[BLOCK.blockId, "x"]]);

  it("drops the files planned for the deleted sheet's blocks", () => {
    const { saver } = coordinator(createFakeGateway(), data);
    const elsewhere = {
      ...planned,
      blockId: blockIdOf(9),
      sheetId: sheetIdOf(9),
    };
    saver.planCreate(planned);
    saver.planCreate(elsewhere);

    saver.planSheetRemoval(SHEET_ID);

    expect(saver.plannedFiles()).toEqual({
      creates: [elsewhere],
      deletes: [],
      sheetDeletes: [SHEET_ID],
    });
  });

  it("takes a directory that is already gone as deleted", async () => {
    const gateway = createFakeGateway();
    gateway.failOn("deleteSheet", "fileNotFound");
    const { saver } = coordinator(gateway, data);
    saver.planSheetRemoval(SHEET_ID);

    expect((await saver.saveDirty()).ok).toBe(true);
    expect(saver.plannedFiles()).toEqual(NO_PLANNED_FILES);
  });

  it("starts from the deletions handed over with a moved Document", () => {
    const saver = createSaveCoordinator({
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      gateway: createFakeGateway(),
      scheduler: createFakeScheduler(),
      autoSaveDelayMs: 1,
      autoSavePolicy: ALWAYS_ENABLED_AUTO_SAVE_POLICY,
      getData: () => data,
      runExclusive: (task) => task(),
      onChange: () => {},
      relocate: () => {},
      plannedFiles: { ...NO_PLANNED_FILES, sheetDeletes: [SHEET_ID] },
    });

    expect(saver.plannedFiles().sheetDeletes).toEqual([SHEET_ID]);
  });
});
