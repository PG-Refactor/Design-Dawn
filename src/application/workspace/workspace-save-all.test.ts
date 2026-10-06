import { describe, expect, it } from "vitest";
import { renameSheetCommand } from "../commands/naming-commands";
import { displayName, settle } from "../test-support/fakes";
import { TEST_AUTO_SAVE_DELAY_MS } from "../test-support/session-harness";
import {
  createWorkspaceHarness,
  DOCUMENT_A,
  DOCUMENT_B,
  errorKind,
  openedDocumentA,
  openedWorkspace,
  SHEET_A1,
  SHEET_B1,
} from "../test-support/workspace-harness";

describe("saveAll", () => {
  it("is ok and writes nothing when no project is open", async () => {
    const { workspace, gateway } = createWorkspaceHarness();
    expect((await workspace.saveAll()).ok).toBe(true);
    expect(gateway.calls).toEqual([]);
  });

  it("writes nothing when nothing is dirty", async () => {
    const { workspace, gateway } = await openedDocumentA();
    expect((await workspace.saveAll()).ok).toBe(true);
    expect(gateway.methods("saveProject", "saveSheet", "saveDocument")).toEqual(
      [],
    );
  });

  it("saves a dirty project and a dirty document", async () => {
    const { workspace, gateway, store } = await openedDocumentA();
    gateway.failOn("saveProject", "ioError");
    await workspace.renameProject("Renamed");
    await workspace
      .getDocumentSession(DOCUMENT_A)
      ?.execute(renameSheetCommand(SHEET_A1, displayName("Dirty")));
    expect(store.getState().project?.save.dirty).toBe(true);
    gateway.clearCalls();

    expect((await workspace.saveAll()).ok).toBe(true);

    expect(gateway.methods("saveProject")).toHaveLength(1);
    expect(gateway.methods("saveSheet").length).toBeGreaterThan(0);
    expect(store.getState().project?.save).toEqual({
      dirty: false,
      lastError: null,
    });
    expect(
      workspace.getDocumentSession(DOCUMENT_A)?.getState().save.dirtySheetIds
        .size,
    ).toBe(0);
  });

  it("still saves the other documents when one fails, and returns the error", async () => {
    const { workspace, gateway } = await openedWorkspace();
    await workspace.openDocument(DOCUMENT_A);
    await workspace.openDocument(DOCUMENT_B);
    await workspace
      .getDocumentSession(DOCUMENT_A)
      ?.execute(renameSheetCommand(SHEET_A1, displayName("A dirty")));
    await workspace
      .getDocumentSession(DOCUMENT_B)
      ?.execute(renameSheetCommand(SHEET_B1, displayName("B dirty")));
    gateway.clearCalls();
    gateway.failOn("saveSheet", "ioError");

    const result = await workspace.saveAll();

    expect(errorKind(result)).toBe("ioError");
    const stateA = workspace.getDocumentSession(DOCUMENT_A)?.getState().save;
    const stateB = workspace.getDocumentSession(DOCUMENT_B)?.getState().save;
    expect(stateA?.dirtySheetIds.size).toBe(1);
    expect(stateA?.lastError?.kind).toBe("ioError");
    expect(stateB?.dirtySheetIds.size).toBe(0);
  });

  it("writes once when an auto-save is pending, and the timer later writes nothing", async () => {
    const { workspace, gateway, scheduler } = await openedDocumentA();
    await workspace
      .getDocumentSession(DOCUMENT_A)
      ?.execute(renameSheetCommand(SHEET_A1, displayName("Dirty")));
    gateway.clearCalls();

    expect((await workspace.saveAll()).ok).toBe(true);
    const writes = gateway.methods("saveSheet").length;
    expect(writes).toBe(1);

    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gateway.methods("saveSheet")).toHaveLength(writes);
  });
});

describe("auto-save policy", () => {
  it("switching auto-save on resumes the timer of every open dirty document", async () => {
    const { workspace, gateway, scheduler, autoSaveController } =
      await openedWorkspace();
    await workspace.openDocument(DOCUMENT_A);
    await workspace.openDocument(DOCUMENT_B);
    await autoSaveController.setEnabled(false);
    await workspace
      .getDocumentSession(DOCUMENT_A)
      ?.execute(renameSheetCommand(SHEET_A1, displayName("Dirty A")));
    await workspace
      .getDocumentSession(DOCUMENT_B)
      ?.execute(renameSheetCommand(SHEET_B1, displayName("Dirty B")));
    gateway.clearCalls();
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();
    expect(gateway.methods("saveSheet")).toEqual([]);

    await autoSaveController.setEnabled(true);
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();

    expect(gateway.methods("saveSheet")).toHaveLength(2);
  });
});
