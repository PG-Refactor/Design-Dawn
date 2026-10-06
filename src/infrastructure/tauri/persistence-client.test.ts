import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseContentPath } from "../../domain/block/content-path";
import { parseDocument } from "../../domain/document/document";
import { parseFolder } from "../../domain/folder/folder";
import { parseProject } from "../../domain/project/project";
import { parseDisplayName } from "../../domain/shared/display-name";
import {
  parseDocumentId,
  parseEntryId,
  parseFolderId,
  parseProjectId,
  parseSheetId,
} from "../../domain/shared/entity-id";
import { unwrap } from "../../domain/shared/test-support";
import { parseSheet } from "../../domain/sheet/sheet";
import { COMMANDS } from "./command-constants";
import type { CommandResult } from "./command-error";
import {
  closeDocument,
  createBlockContent,
  createDocument,
  createFolder,
  createProject,
  createSheet,
  deleteBlockContent,
  deleteDocument,
  deleteFolder,
  deleteSheet,
  loadDocument,
  moveEntry,
  openProject,
  readBlockContent,
  restoreBlockContent,
  saveFolder,
  saveProject,
  saveSheet,
  selectProjectFolder,
  writeBlockContent,
} from "./persistence-client";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

const PROJECT_ID = "01928f3a-5b6c-7d8e-9f01-23456789abcd";
const DOCUMENT_ID = "01928f3a-6c7d-7e8f-a012-3456789abcde";
const SHEET_ID = "01928f3a-7d8e-7f90-b123-456789abcdef";
const FAILED_SHEET_ID = "01928f3a-7d8f-7f90-b123-456789abcdef";
const BLOCK_ID = "01928f3a-8e9f-7a01-8234-56789abcdef0";
const SELECTION_ID = "01928f3a-aaaa-7bbb-8ccc-0123456789ab";
const CONTENT_PATH = "sheets/overview/blocks/markdown-1.md";

const projectId = unwrap(parseProjectId(PROJECT_ID));
const documentId = unwrap(parseDocumentId(DOCUMENT_ID));
const sheetId = unwrap(parseSheetId(SHEET_ID));
const contentPath = unwrap(parseContentPath(CONTENT_PATH));
const name = unwrap(parseDisplayName("Name"));

const rawProject = {
  schemaVersion: 2,
  projectId: PROJECT_ID,
  name: "Project",
  childOrder: [DOCUMENT_ID],
};
const rawBlock = {
  blockId: BLOCK_ID,
  blockType: "markdown",
  position: { x: 100, y: -200 },
  size: { width: 480, height: 320 },
  contentPath: CONTENT_PATH,
};
const rawSheet = {
  schemaVersion: 1,
  sheetId: SHEET_ID,
  name: "Overview",
  blocks: [rawBlock],
};
const rawIssue = {
  kind: "orphanContent",
  path: "documents/x/sheets/y/blocks/stray.md",
  entityId: null,
  detail: "no block references this file",
};
const rawProjectSnapshot = {
  project: rawProject,
  folders: [],
  documents: [
    {
      documentId: DOCUMENT_ID,
      parentFolderId: null,
      name: "System Design",
      state: "loaded",
    },
  ],
  issues: [rawIssue],
};
const rawDocumentSnapshot = {
  document: {
    schemaVersion: 1,
    documentId: DOCUMENT_ID,
    name: "System Design",
    sheetOrder: [SHEET_ID, FAILED_SHEET_ID],
  },
  sheets: [
    { sheetId: SHEET_ID, name: "Overview", state: "loaded", sheet: rawSheet },
    { sheetId: FAILED_SHEET_ID, name: null, state: "loadFailed", sheet: null },
  ],
  issues: [],
};

function expectFailure<T>(result: CommandResult<T>, kind: string) {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.kind).toBe(kind);
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("successful conversion", () => {
  it("turns an open_project payload into domain values", async () => {
    invokeMock.mockResolvedValue(rawProjectSnapshot);
    const result = await openProject(SELECTION_ID);
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.openProject, {
      selectionId: SELECTION_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.project.projectId).toBe(PROJECT_ID);
    expect(result.value.project.childOrder).toEqual([DOCUMENT_ID]);
    expect(result.value.folders).toEqual([]);
    expect(result.value.documents).toEqual([
      {
        documentId: DOCUMENT_ID,
        parentFolderId: null,
        name: "System Design",
        state: "loaded",
      },
    ]);
    expect(result.value.issues).toEqual([rawIssue]);
  });

  it("converts a document with a loaded and a failed sheet", async () => {
    invokeMock.mockResolvedValue(rawDocumentSnapshot);
    const result = await loadDocument(projectId, documentId);
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.loadDocument, {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [loaded, failed] = result.value.sheets;
    expect(loaded?.sheet?.blocks[0]?.position).toEqual({ x: 100, y: -200 });
    expect(failed?.state).toBe("loadFailed");
    expect(failed?.sheet).toBeNull();
    expect(result.value.document.sheetOrder).toEqual([
      SHEET_ID,
      FAILED_SHEET_ID,
    ]);
  });

  it("converts create_sheet, content and save results", async () => {
    invokeMock.mockResolvedValueOnce({
      sheetId: SHEET_ID,
      name: "Overview",
      state: "loaded",
      sheet: rawSheet,
    });
    const created = await createSheet(projectId, documentId, sheetId, name);
    expect(invokeMock).toHaveBeenLastCalledWith(COMMANDS.createSheet, {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      sheetId: SHEET_ID,
      name: "Name",
    });
    expect(created.ok && created.value.sheet?.name).toBe("Overview");

    invokeMock.mockResolvedValueOnce(CONTENT_PATH);
    const path = await createBlockContent(
      projectId,
      documentId,
      sheetId,
      "markdown",
      "# Hi",
    );
    expect(invokeMock).toHaveBeenLastCalledWith(COMMANDS.createBlockContent, {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      sheetId: SHEET_ID,
      blockType: "markdown",
      text: "# Hi",
    });
    expect(path.ok && path.value).toBe(CONTENT_PATH);

    invokeMock.mockResolvedValueOnce("body");
    const text = await readBlockContent(projectId, documentId, contentPath);
    expect(text.ok && text.value).toBe("body");

    invokeMock.mockResolvedValueOnce({ written: false });
    const written = await writeBlockContent(
      projectId,
      documentId,
      contentPath,
      "body",
    );
    expect(written.ok && written.value).toEqual({ written: false });

    invokeMock.mockResolvedValueOnce(null);
    const deleted = await deleteBlockContent(
      projectId,
      documentId,
      contentPath,
    );
    expect(deleted).toEqual({ ok: true, value: null });
  });

  it("sends restore and delete commands with the documented arguments", async () => {
    invokeMock.mockResolvedValue(null);
    const restored = await restoreBlockContent(
      projectId,
      documentId,
      "markdown",
      contentPath,
      "# Back",
    );
    expect(restored).toEqual({ ok: true, value: null });
    expect(invokeMock).toHaveBeenLastCalledWith(COMMANDS.restoreBlockContent, {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      blockType: "markdown",
      contentPath: CONTENT_PATH,
      text: "# Back",
    });

    const sheetDeleted = await deleteSheet(projectId, documentId, sheetId);
    expect(sheetDeleted).toEqual({ ok: true, value: null });
    expect(invokeMock).toHaveBeenLastCalledWith(COMMANDS.deleteSheet, {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      sheetId: SHEET_ID,
    });

    const documentDeleted = await deleteDocument(projectId, documentId);
    expect(documentDeleted).toEqual({ ok: true, value: null });
    expect(invokeMock).toHaveBeenLastCalledWith(COMMANDS.deleteDocument, {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
    });
  });

  it("sends only the ids to close a document", async () => {
    invokeMock.mockResolvedValue(null);
    expect(await closeDocument(projectId, documentId)).toEqual({
      ok: true,
      value: null,
    });
    expect(invokeMock).toHaveBeenLastCalledWith(COMMANDS.closeDocument, {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
    });
  });

  it("sends domain entities as they are for saves", async () => {
    const project = unwrap(parseProject(rawProject));
    const sheet = unwrap(parseSheet(rawSheet));
    invokeMock.mockResolvedValue({ written: true });
    await saveProject(projectId, project);
    expect(invokeMock).toHaveBeenLastCalledWith(COMMANDS.saveProject, {
      projectId: PROJECT_ID,
      project: rawProject,
    });
    await saveSheet(projectId, documentId, sheet);
    expect(invokeMock).toHaveBeenLastCalledWith(COMMANDS.saveSheet, {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      sheet: rawSheet,
    });
    const document = unwrap(parseDocument(rawDocumentSnapshot.document));
    expect(document.sheetOrder).toHaveLength(2);
  });
});

const FOLDER_ID = "01928f3a-2000-7000-8000-000000000001";
const CHILD_FOLDER_ID = "01928f3a-2000-7000-8000-000000000002";

const rawFolderTreeSnapshot = {
  project: { ...rawProject, childOrder: [FOLDER_ID] },
  folders: [
    {
      folderId: FOLDER_ID,
      name: "Architecture",
      parentFolderId: null,
      childOrder: [CHILD_FOLDER_ID, DOCUMENT_ID],
      state: "loaded",
    },
    {
      folderId: CHILD_FOLDER_ID,
      name: null,
      parentFolderId: FOLDER_ID,
      childOrder: [],
      state: "loadFailed",
    },
  ],
  documents: [
    {
      documentId: DOCUMENT_ID,
      parentFolderId: FOLDER_ID,
      name: "System Design",
      state: "loaded",
    },
  ],
  issues: [],
};

describe("folder tree payloads", () => {
  it("converts folders with their parent, child order and state", async () => {
    invokeMock.mockResolvedValue(rawFolderTreeSnapshot);
    const result = await openProject(SELECTION_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.project.childOrder).toEqual([FOLDER_ID]);
    expect(result.value.folders).toEqual([
      {
        folderId: FOLDER_ID,
        name: "Architecture",
        parentFolderId: null,
        childOrder: [CHILD_FOLDER_ID, DOCUMENT_ID],
        state: "loaded",
      },
      {
        folderId: CHILD_FOLDER_ID,
        name: null,
        parentFolderId: FOLDER_ID,
        childOrder: [],
        state: "loadFailed",
      },
    ]);
    expect(result.value.documents[0]?.parentFolderId).toBe(FOLDER_ID);
  });

  it("rejects a snapshot without the folders list", async () => {
    invokeMock.mockResolvedValue({ ...rawProjectSnapshot, folders: undefined });
    expectFailure(await openProject(SELECTION_ID), "invalidCommandResponse");
  });

  it("rejects malformed folder ids, parents and child entries", async () => {
    const [folder] = rawFolderTreeSnapshot.folders;
    for (const broken of [
      { ...folder, folderId: "not-an-id" },
      { ...folder, parentFolderId: "not-an-id" },
      { ...folder, childOrder: ["not-an-id"] },
      { ...folder, state: "gone" },
    ]) {
      invokeMock.mockResolvedValue({
        ...rawFolderTreeSnapshot,
        folders: [broken],
      });
      const result = await openProject(SELECTION_ID);
      expect(result.ok).toBe(false);
    }
  });
});

describe("payload validation", () => {
  it("rejects a payload with a missing field as invalidCommandResponse", async () => {
    invokeMock.mockResolvedValue({
      ...rawProjectSnapshot,
      documents: undefined,
    });
    const result = await openProject(SELECTION_ID);
    expectFailure(result, "invalidCommandResponse");
    if (!result.ok) expect(result.error.detail).toContain("payload.documents");
  });

  it("rejects unknown enum values in the payload", async () => {
    invokeMock.mockResolvedValue({
      ...rawProjectSnapshot,
      issues: [{ ...rawIssue, kind: "somethingNew" }],
    });
    expectFailure(await openProject(SELECTION_ID), "invalidCommandResponse");
  });

  it("re-validates entities with the domain parsers", async () => {
    invokeMock.mockResolvedValue({
      ...rawProjectSnapshot,
      project: { ...rawProject, projectId: "not-an-id" },
    });
    expectFailure(await openProject(SELECTION_ID), "invalidEntityId");

    invokeMock.mockResolvedValue({
      ...rawDocumentSnapshot,
      sheets: [
        {
          sheetId: SHEET_ID,
          name: "Overview",
          state: "loaded",
          sheet: {
            ...rawSheet,
            blocks: [{ ...rawBlock, position: { x: 1.5, y: 0 } }],
          },
        },
      ],
    });
    expectFailure(await loadDocument(projectId, documentId), "invalidPosition");
  });

  it("rejects a sheet whose state disagrees with its data", async () => {
    invokeMock.mockResolvedValue({
      ...rawDocumentSnapshot,
      sheets: [{ sheetId: SHEET_ID, name: null, state: "loaded", sheet: null }],
    });
    expectFailure(
      await loadDocument(projectId, documentId),
      "invalidCommandResponse",
    );
  });

  it("rejects an empty content path and an unexpected delete payload", async () => {
    invokeMock.mockResolvedValueOnce("");
    expectFailure(
      await createBlockContent(projectId, documentId, sheetId, "mermaid", ""),
      "invalidContentPath",
    );
    invokeMock.mockResolvedValueOnce({ surprise: true });
    expectFailure(
      await deleteBlockContent(projectId, documentId, contentPath),
      "invalidCommandResponse",
    );
    invokeMock.mockResolvedValueOnce({ surprise: true });
    expectFailure(
      await restoreBlockContent(
        projectId,
        documentId,
        "markdown",
        contentPath,
        "",
      ),
      "invalidCommandResponse",
    );
    invokeMock.mockResolvedValueOnce("unexpected");
    expectFailure(
      await deleteSheet(projectId, documentId, sheetId),
      "invalidCommandResponse",
    );
    invokeMock.mockResolvedValueOnce(42);
    expectFailure(
      await deleteDocument(projectId, documentId),
      "invalidCommandResponse",
    );
    invokeMock.mockResolvedValueOnce({ written: "yes" });
    expectFailure(
      await writeBlockContent(projectId, documentId, contentPath, ""),
      "invalidCommandResponse",
    );
  });
});

describe("error mapping", () => {
  it("passes Rust errors through without throwing", async () => {
    invokeMock.mockRejectedValue({ kind: "notWritable", detail: "sheet x" });
    const result = await saveSheet(
      projectId,
      documentId,
      unwrap(parseSheet(rawSheet)),
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: "notWritable", detail: "sheet x" },
    });
  });

  it("passes the restore and delete refusals through", async () => {
    invokeMock.mockRejectedValueOnce({ kind: "alreadyExists", detail: "d" });
    expectFailure(
      await restoreBlockContent(
        projectId,
        documentId,
        "markdown",
        contentPath,
        "",
      ),
      "alreadyExists",
    );
    invokeMock.mockRejectedValueOnce({ kind: "pathOutsideRoot", detail: "d" });
    expectFailure(
      await deleteSheet(projectId, documentId, sheetId),
      "pathOutsideRoot",
    );
    invokeMock.mockRejectedValueOnce({ kind: "entityNotFound", detail: "d" });
    expectFailure(
      await deleteDocument(projectId, documentId),
      "entityNotFound",
    );
  });

  it("accepts every documented error kind", async () => {
    for (const kind of [
      "invalidJson",
      "invalidFileStructure",
      "invalidEncoding",
      "pathOutsideRoot",
      "fileNotFound",
      "alreadyExists",
      "notWritable",
      "projectNotOpen",
      "dialogFailed",
      "invalidFolderSelection",
      "ioError",
      "entityNotFound",
      "invalidContentExtension",
      "duplicateId",
    ]) {
      invokeMock.mockRejectedValueOnce({ kind, detail: "d" });
      const result = await openProject(SELECTION_ID);
      expect(!result.ok && result.error.kind).toBe(kind);
    }
  });

  it("maps non-conforming rejections to unexpectedCommandError", async () => {
    const rejections: unknown[] = [
      "command open_project not allowed by ACL",
      new Error("boom"),
      { kind: "madeUpKind", detail: "x" },
      { kind: "invalidCommandResponse", detail: "forged client kind" },
      { kind: "notWritable" },
      null,
    ];
    for (const rejection of rejections) {
      invokeMock.mockRejectedValueOnce(rejection);
      const result = await openProject(SELECTION_ID);
      expectFailure(result, "unexpectedCommandError");
    }
    invokeMock.mockRejectedValueOnce("plain string");
    const result = await openProject(SELECTION_ID);
    expect(!result.ok && result.error.detail).toBe("plain string");
  });
});

describe("folder selection", () => {
  it("returns a selected folder with its selection id and display path", async () => {
    invokeMock.mockResolvedValue({
      status: "selected",
      selectionId: SELECTION_ID,
      displayPath: "/projects/basic",
    });
    const result = await selectProjectFolder();
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.selectProjectFolder, {});
    expect(result).toEqual({
      ok: true,
      value: {
        status: "selected",
        selectionId: SELECTION_ID,
        displayPath: "/projects/basic",
      },
    });
  });

  it("returns cancelling as an ok result, not an error", async () => {
    invokeMock.mockResolvedValue({ status: "cancelled" });
    const result = await selectProjectFolder();
    expect(result).toEqual({ ok: true, value: { status: "cancelled" } });
  });

  it("maps a dialog failure to dialogFailed", async () => {
    invokeMock.mockRejectedValueOnce({ kind: "dialogFailed", detail: "d" });
    expectFailure(await selectProjectFolder(), "dialogFailed");
  });

  it("maps an unknown selection id to invalidFolderSelection", async () => {
    invokeMock.mockRejectedValueOnce({
      kind: "invalidFolderSelection",
      detail: "d",
    });
    expectFailure(await openProject(SELECTION_ID), "invalidFolderSelection");
  });

  it("rejects malformed selection payloads as invalidCommandResponse", async () => {
    const malformed: unknown[] = [
      null,
      "selected",
      {},
      { status: "somethingNew" },
      { status: "selected" },
      { status: "selected", selectionId: SELECTION_ID },
      { status: "selected", selectionId: 1, displayPath: "/p" },
    ];
    for (const payload of malformed) {
      invokeMock.mockResolvedValueOnce(payload);
      expectFailure(await selectProjectFolder(), "invalidCommandResponse");
    }
  });

  it("sends selectionId, never a path, to open_project and create_project", async () => {
    invokeMock.mockResolvedValue(rawProjectSnapshot);
    await openProject(SELECTION_ID);
    await createProject(SELECTION_ID, name);
    expect(invokeMock).toHaveBeenNthCalledWith(1, COMMANDS.openProject, {
      selectionId: SELECTION_ID,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, COMMANDS.createProject, {
      selectionId: SELECTION_ID,
      name,
    });
  });
});

describe("folder commands", () => {
  const folderId = unwrap(parseFolderId(FOLDER_ID));
  const childFolderId = unwrap(parseFolderId(CHILD_FOLDER_ID));
  const rawCreatedFolder = {
    folderId: FOLDER_ID,
    name: "Architecture",
    parentFolderId: null,
    childOrder: [],
    state: "loaded",
  };

  it("sends the parent (null = Project root) and converts the created folder", async () => {
    invokeMock.mockResolvedValue(rawCreatedFolder);
    const result = await createFolder(projectId, null, folderId, name);
    expect(invokeMock).toHaveBeenLastCalledWith(COMMANDS.createFolder, {
      projectId: PROJECT_ID,
      parentFolderId: null,
      folderId: FOLDER_ID,
      name: "Name",
    });
    expect(result).toEqual({ ok: true, value: rawCreatedFolder });

    invokeMock.mockResolvedValue({
      ...rawCreatedFolder,
      folderId: CHILD_FOLDER_ID,
      parentFolderId: FOLDER_ID,
    });
    const nested = await createFolder(projectId, folderId, childFolderId, name);
    expect(invokeMock).toHaveBeenLastCalledWith(COMMANDS.createFolder, {
      projectId: PROJECT_ID,
      parentFolderId: FOLDER_ID,
      folderId: CHILD_FOLDER_ID,
      name: "Name",
    });
    expect(nested.ok && nested.value.parentFolderId).toBe(folderId);
  });

  it("rejects a created-folder payload that is malformed", async () => {
    for (const broken of [
      { ...rawCreatedFolder, folderId: "not-an-id" },
      { ...rawCreatedFolder, parentFolderId: "not-an-id" },
      { ...rawCreatedFolder, state: "gone" },
      { ...rawCreatedFolder, childOrder: undefined },
    ]) {
      invokeMock.mockResolvedValueOnce(broken);
      expect((await createFolder(projectId, null, folderId, name)).ok).toBe(
        false,
      );
    }
  });

  it("sends the folder entity as it is for a save", async () => {
    const folder = unwrap(
      parseFolder({
        schemaVersion: 1,
        folderId: FOLDER_ID,
        name: "Architecture",
        childOrder: [CHILD_FOLDER_ID, DOCUMENT_ID],
      }),
    );
    invokeMock.mockResolvedValue({ written: false });
    const result = await saveFolder(projectId, folder);
    expect(invokeMock).toHaveBeenLastCalledWith(COMMANDS.saveFolder, {
      projectId: PROJECT_ID,
      folder: {
        schemaVersion: 1,
        folderId: FOLDER_ID,
        name: "Architecture",
        childOrder: [CHILD_FOLDER_ID, DOCUMENT_ID],
      },
    });
    expect(result).toEqual({ ok: true, value: { written: false } });
  });

  it("sends only ids to move an entry and to delete a folder", async () => {
    invokeMock.mockResolvedValue(null);
    const entryId = unwrap(parseEntryId(DOCUMENT_ID));
    expect(await moveEntry(projectId, entryId, folderId)).toEqual({
      ok: true,
      value: null,
    });
    expect(invokeMock).toHaveBeenLastCalledWith(COMMANDS.moveEntry, {
      projectId: PROJECT_ID,
      entryId: DOCUMENT_ID,
      targetParentFolderId: FOLDER_ID,
    });
    await moveEntry(projectId, entryId, null);
    expect(invokeMock).toHaveBeenLastCalledWith(COMMANDS.moveEntry, {
      projectId: PROJECT_ID,
      entryId: DOCUMENT_ID,
      targetParentFolderId: null,
    });
    expect(await deleteFolder(projectId, folderId)).toEqual({
      ok: true,
      value: null,
    });
    expect(invokeMock).toHaveBeenLastCalledWith(COMMANDS.deleteFolder, {
      projectId: PROJECT_ID,
      folderId: FOLDER_ID,
    });
  });

  it("creates a document under a folder, or at the root by default", async () => {
    invokeMock.mockResolvedValue(rawDocumentSnapshot);
    await createDocument(projectId, documentId, name, folderId);
    expect(invokeMock).toHaveBeenLastCalledWith(COMMANDS.createDocument, {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      name: "Name",
      parentFolderId: FOLDER_ID,
    });
    await createDocument(projectId, documentId, name);
    expect(invokeMock).toHaveBeenLastCalledWith(COMMANDS.createDocument, {
      projectId: PROJECT_ID,
      documentId: DOCUMENT_ID,
      name: "Name",
      parentFolderId: null,
    });
  });

  it("passes the new error kinds through and rejects a non-void response", async () => {
    for (const kind of ["folderNotEmpty", "invalidMove"]) {
      invokeMock.mockRejectedValueOnce({ kind, detail: "d" });
      expectFailure(await deleteFolder(projectId, folderId), kind);
    }
    invokeMock.mockResolvedValueOnce(42);
    expectFailure(
      await moveEntry(projectId, unwrap(parseEntryId(DOCUMENT_ID)), null),
      "invalidCommandResponse",
    );
  });
});
