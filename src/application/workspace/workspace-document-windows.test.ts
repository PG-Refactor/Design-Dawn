import { describe, expect, it } from "vitest";
import {
  renameDocumentCommand,
  renameSheetCommand,
} from "../commands/naming-commands";
import {
  createFakeDocumentWindows,
  type FakeDocumentWindows,
} from "../test-support/fake-document-windows";
import { displayName } from "../test-support/fakes";
import {
  createWorkspaceHarness,
  DOCUMENT_A,
  errorKind,
  SELECTION_ID,
  SHEET_A1,
  type WorkspaceHarness,
} from "../test-support/workspace-harness";

const MAIN = "main";
const NEW_WINDOW = { kind: "newWindow", screenX: 300, screenY: 200 } as const;

// An undoable edit that is only in memory until saved.
const renameSheet = (name: string) =>
  renameSheetCommand(SHEET_A1, displayName(name));

interface TwoWindows {
  readonly windows: FakeDocumentWindows;
  readonly main: WorkspaceHarness;
}

// The Project window, with Document A open and one unsaved, undoable edit in it.
async function projectWindowWithEditedDocument(): Promise<TwoWindows> {
  const first = createWorkspaceHarness();
  const windows = createFakeDocumentWindows(first.gateway);
  const main = createWorkspaceHarness({
    sharedGateway: first.gateway,
    windows: windows.gatewayFor(MAIN),
  });
  expect((await main.workspace.openProject(SELECTION_ID)).ok).toBe(true);
  expect((await main.workspace.openDocument(DOCUMENT_A)).ok).toBe(true);
  await main.workspace
    .getDocumentSession(DOCUMENT_A)
    ?.execute(renameSheet("Edited"));
  main.gateway.clearCalls();
  return { windows, main };
}

// The window Rust creates for the moved Document: it starts with the hand-over.
async function documentWindowFor(
  { windows, main }: TwoWindows,
  label: string,
): Promise<WorkspaceHarness> {
  const sent = windows.sent.at(-1);
  if (sent === undefined) throw new Error("nothing was moved");
  const window = createWorkspaceHarness({
    sharedGateway: main.gateway,
    windows: windows.gatewayFor(label),
  });
  main.gateway.queueTransferRequest(sent.transferId);
  const opened = await window.workspace.openLaunchRequest();
  expect(opened).toEqual({ ok: true, value: DOCUMENT_A });
  return window;
}

const sheetName = (harness: WorkspaceHarness) =>
  harness.store.getState().documents.get(DOCUMENT_A)?.sheets.get(SHEET_A1)
    ?.name;

describe("moving a Document to another window", () => {
  it("drops it here without saving or closing it in Rust", async () => {
    const two = await projectWindowWithEditedDocument();
    const moved = await two.main.workspace.moveDocumentToWindow(
      DOCUMENT_A,
      NEW_WINDOW,
    );
    expect(moved.ok).toBe(true);
    expect(two.main.store.getState().documents.has(DOCUMENT_A)).toBe(false);
    expect(two.main.workspace.getDocumentSession(DOCUMENT_A)).toBeNull();
    expect(two.main.gateway.methods()).toEqual([]);
    expect(two.windows.sent[0]?.target).toEqual(NEW_WINDOW);
  });

  it("arrives in a Document window with its unsaved edit and its history", async () => {
    const two = await projectWindowWithEditedDocument();
    await two.main.workspace.moveDocumentToWindow(DOCUMENT_A, NEW_WINDOW);
    const window = await documentWindowFor(two, "window-new-1");

    expect(window.store.getState().windowRole).toBe("document");
    expect(sheetName(window)).toBe("Edited");
    const state = window.store.getState().documents.get(DOCUMENT_A);
    expect(
      state?.save.documentDirty || state?.save.dirtySheetIds.has(SHEET_A1),
    ).toBe(true);
    expect(state?.history.undoLabel).toBe("renameSheet");
    await window.workspace.getDocumentSession(DOCUMENT_A)?.undo();
    expect(sheetName(window)).toBe("Sheet A1");
  });

  it("is saved from the window it moved to", async () => {
    const two = await projectWindowWithEditedDocument();
    await two.main.workspace.moveDocumentToWindow(DOCUMENT_A, NEW_WINDOW);
    const window = await documentWindowFor(two, "window-new-1");
    window.gateway.clearCalls();

    expect((await window.workspace.saveAll()).ok).toBe(true);
    expect(window.gateway.methods()).toContain("saveSheet");
    expect(
      window.store.getState().documents.get(DOCUMENT_A)?.save.dirtySheetIds
        .size,
    ).toBe(0);
  });

  it("stays here exactly as it was when the move fails", async () => {
    const two = await projectWindowWithEditedDocument();
    const before = two.main.store.getState().documents.get(DOCUMENT_A);
    two.windows.failNextTransfer();

    const moved = await two.main.workspace.moveDocumentToWindow(
      DOCUMENT_A,
      NEW_WINDOW,
    );

    expect(errorKind(moved)).toBe("ioError");
    const after = two.main.store.getState().documents.get(DOCUMENT_A);
    expect(sheetName(two.main)).toBe("Edited");
    expect(after?.save.dirtySheetIds).toEqual(before?.save.dirtySheetIds);
    expect(after?.history).toEqual(before?.history);
    // The session is live: undo works on it.
    await two.main.workspace.getDocumentSession(DOCUMENT_A)?.undo();
    expect(sheetName(two.main)).toBe("Sheet A1");
  });

  it("comes back to the Project window with everything, and can go again", async () => {
    const two = await projectWindowWithEditedDocument();
    await two.main.workspace.moveDocumentToWindow(DOCUMENT_A, NEW_WINDOW);
    const window = await documentWindowFor(two, "window-new-1");
    await window.workspace
      .getDocumentSession(DOCUMENT_A)
      ?.execute(renameSheet("Edited again"));

    const back = await window.workspace.moveDocumentToWindow(DOCUMENT_A, {
      kind: "window",
      label: MAIN,
    });
    expect(back.ok).toBe(true);
    const transferId = two.windows.sent.at(-1)?.transferId ?? "";
    const received = await two.main.workspace.receiveDocument(transferId);

    expect(received).toEqual({ ok: true, value: DOCUMENT_A });
    expect(sheetName(two.main)).toBe("Edited again");
    await two.main.workspace.getDocumentSession(DOCUMENT_A)?.undo();
    expect(sheetName(two.main)).toBe("Edited");
    // Announced again (a window that subscribes while starting): nothing more happens.
    expect(await two.main.workspace.receiveDocument(transferId)).toEqual({
      ok: true,
      value: DOCUMENT_A,
    });
    expect(sheetName(two.main)).toBe("Edited");
  });

  it("refuses a Document from another read of the Project", async () => {
    const two = await projectWindowWithEditedDocument();
    await two.main.workspace.moveDocumentToWindow(DOCUMENT_A, NEW_WINDOW);
    const window = await documentWindowFor(two, "window-new-1");
    await window.workspace.moveDocumentToWindow(DOCUMENT_A, {
      kind: "window",
      label: MAIN,
    });
    // The Project window read the Project again meanwhile.
    expect((await two.main.workspace.reloadProject()).ok).toBe(true);

    const received = await two.main.workspace.receiveDocument(
      two.windows.sent.at(-1)?.transferId ?? "",
    );

    expect(errorKind(received)).toBe("invalidDocumentTransfer");
  });

  it("takes over a Document name changed in the window that holds it", async () => {
    const two = await projectWindowWithEditedDocument();
    await two.main.workspace.moveDocumentToWindow(DOCUMENT_A, NEW_WINDOW);
    const window = await documentWindowFor(two, "window-new-1");
    await window.workspace
      .getDocumentSession(DOCUMENT_A)
      ?.execute(renameDocumentCommand(displayName("Renamed A")));
    await window.workspace.saveAll();

    expect((await two.main.workspace.refreshProjectTree()).ok).toBe(true);

    const entry = two.main.store
      .getState()
      .project?.documents.find(
        (document) => document.documentId === DOCUMENT_A,
      );
    expect(entry?.name).toBe("Renamed A");
  });
});
