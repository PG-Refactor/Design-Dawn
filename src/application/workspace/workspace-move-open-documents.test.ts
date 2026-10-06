import { describe, expect, it } from "vitest";
import { renameSheetCommand } from "../commands/naming-commands";
import { displayName } from "../test-support/fakes";
import {
  DOCUMENT_A,
  DOCUMENT_C,
  DOCUMENT_D,
  errorKind,
  FOLDER_1,
  FOLDER_2,
  openedFolderDiskWorkspace,
  SHEET_A1,
  SHEET_D1,
} from "../test-support/workspace-harness";

describe("moving open documents", () => {
  it("moves an open document and a folder holding one, which stay open", async () => {
    const harness = await openedFolderDiskWorkspace();
    await harness.workspace.openDocument(DOCUMENT_D);
    harness.gateway.clearCalls();

    expect((await harness.workspace.moveEntry(DOCUMENT_D, null)).ok).toBe(true);
    expect(harness.gateway.methods("moveEntry")).toHaveLength(1);
    expect(harness.workspace.getDocumentSession(DOCUMENT_D)).not.toBeNull();
    expect(harness.store.getState().documents.has(DOCUMENT_D)).toBe(true);

    await harness.workspace.moveEntry(DOCUMENT_D, FOLDER_2);
    expect((await harness.workspace.moveEntry(FOLDER_2, null)).ok).toBe(true);
    expect(harness.workspace.getDocumentSession(DOCUMENT_D)).not.toBeNull();
    expect(harness.gateway.disk.folders.get(FOLDER_2)?.parentFolderId).toBe(
      null,
    );
  });

  it("still rejects a folder moved into itself or a descendant when a document inside is open", async () => {
    const harness = await openedFolderDiskWorkspace();
    await harness.workspace.openDocument(DOCUMENT_D);
    harness.gateway.clearCalls();
    expect(
      errorKind(await harness.workspace.moveEntry(FOLDER_1, FOLDER_2)),
    ).toBe("invalidMove");
    expect(harness.gateway.calls).toEqual([]);
  });
});

describe("openDocumentsUnder", () => {
  it("lists the open documents a move would carry along, at any depth", async () => {
    const harness = await openedFolderDiskWorkspace();
    await harness.workspace.openDocument(DOCUMENT_D);
    await harness.workspace.openDocument(DOCUMENT_A);
    const { workspace } = harness;
    expect(workspace.openDocumentsUnder(DOCUMENT_D)).toEqual([DOCUMENT_D]);
    expect(workspace.openDocumentsUnder(DOCUMENT_A)).toEqual([DOCUMENT_A]);
    expect(workspace.openDocumentsUnder(FOLDER_2)).toEqual([DOCUMENT_D]);
    expect(workspace.openDocumentsUnder(FOLDER_1)).toEqual([DOCUMENT_D]);
  });

  it("is empty for a closed document, a folder without open documents and an unknown entry", async () => {
    const harness = await openedFolderDiskWorkspace();
    await harness.workspace.openDocument(DOCUMENT_A);
    const { workspace } = harness;
    expect(workspace.openDocumentsUnder(DOCUMENT_C)).toEqual([]);
    expect(workspace.openDocumentsUnder(FOLDER_1)).toEqual([]);
    expect(
      workspace.openDocumentsUnder(
        "01928f3a-ffff-7fff-bfff-ffffffffffff" as typeof FOLDER_1,
      ),
    ).toEqual([]);
  });
});

describe("flushDocuments", () => {
  async function twoDirtyDocuments() {
    const harness = await openedFolderDiskWorkspace();
    await harness.workspace.openDocument(DOCUMENT_A);
    await harness.workspace.openDocument(DOCUMENT_D);
    await harness.workspace
      .getDocumentSession(DOCUMENT_A)
      ?.execute(renameSheetCommand(SHEET_A1, displayName("A dirty")));
    await harness.workspace
      .getDocumentSession(DOCUMENT_D)
      ?.execute(renameSheetCommand(SHEET_D1, displayName("D dirty")));
    harness.gateway.clearCalls();
    return harness;
  }

  const dirtySheets = (
    harness: Awaited<ReturnType<typeof twoDirtyDocuments>>,
    documentId: typeof DOCUMENT_A,
  ) =>
    harness.workspace.getDocumentSession(documentId)?.getState().save
      .dirtySheetIds.size;

  it("saves only the given documents", async () => {
    const harness = await twoDirtyDocuments();
    expect((await harness.workspace.flushDocuments([DOCUMENT_D])).ok).toBe(
      true,
    );
    expect(harness.gateway.methods("saveSheet")).toHaveLength(1);
    expect(dirtySheets(harness, DOCUMENT_D)).toBe(0);
    expect(dirtySheets(harness, DOCUMENT_A)).toBe(1);
  });

  it("skips ids that are not open and writes nothing for an empty list", async () => {
    const harness = await twoDirtyDocuments();
    expect((await harness.workspace.flushDocuments([DOCUMENT_C])).ok).toBe(
      true,
    );
    expect((await harness.workspace.flushDocuments([])).ok).toBe(true);
    expect(harness.gateway.calls).toEqual([]);
  });

  it("tries every document and returns the first error", async () => {
    const harness = await twoDirtyDocuments();
    harness.gateway.failOn("saveSheet", "ioError");
    const result = await harness.workspace.flushDocuments([
      DOCUMENT_A,
      DOCUMENT_D,
    ]);
    expect(errorKind(result)).toBe("ioError");
    expect(dirtySheets(harness, DOCUMENT_A)).toBe(1);
    expect(dirtySheets(harness, DOCUMENT_D)).toBe(0);
  });
});
