import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseContentPath } from "../../domain/block/content-path";
import { parseDocument } from "../../domain/document/document";
import { parseProject } from "../../domain/project/project";
import { parseDisplayName } from "../../domain/shared/display-name";
import {
  parseDocumentId,
  parseProjectId,
  parseSheetId,
} from "../../domain/shared/entity-id";
import { unwrap } from "../../domain/shared/test-support";
import { parseSheet } from "../../domain/sheet/sheet";
import { COMMANDS } from "./command-constants";
import type { CommandResult } from "./command-error";
import {
  createBlockContent,
  createSheet,
  deleteBlockContent,
  deleteDocument,
  deleteSheet,
  loadDocument,
  openEntryPoint,
  openProject,
  readBlockContent,
  restoreBlockContent,
  saveProject,
  saveSheet,
  writeBlockContent,
} from "./persistence-client";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

const PROJECT_ID = "01928f3a-5b6c-7d8e-9f01-23456789abcd";
const DOCUMENT_ID = "01928f3a-6c7d-7e8f-a012-3456789abcde";
const SHEET_ID = "01928f3a-7d8e-7f90-b123-456789abcdef";
const FAILED_SHEET_ID = "01928f3a-7d8f-7f90-b123-456789abcdef";
const BLOCK_ID = "01928f3a-8e9f-7a01-8234-56789abcdef0";
const CONTENT_PATH = "sheets/overview/blocks/markdown-1.md";

const projectId = unwrap(parseProjectId(PROJECT_ID));
const documentId = unwrap(parseDocumentId(DOCUMENT_ID));
const sheetId = unwrap(parseSheetId(SHEET_ID));
const contentPath = unwrap(parseContentPath(CONTENT_PATH));
const name = unwrap(parseDisplayName("Name"));

const rawProject = {
  schemaVersion: 1,
  projectId: PROJECT_ID,
  name: "Project",
  documentOrder: [DOCUMENT_ID],
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
  documents: [
    { documentId: DOCUMENT_ID, name: "System Design", state: "loaded" },
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
    const result = await openProject("/projects/basic");
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.openProject, {
      projectRoot: "/projects/basic",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.project.projectId).toBe(PROJECT_ID);
    expect(result.value.project.documentOrder).toEqual([DOCUMENT_ID]);
    expect(result.value.documents).toEqual([
      { documentId: DOCUMENT_ID, name: "System Design", state: "loaded" },
    ]);
    expect(result.value.issues).toEqual([rawIssue]);
  });

  it("converts entry point snapshots", async () => {
    invokeMock.mockResolvedValue({
      snapshot: rawProjectSnapshot,
      documentId: DOCUMENT_ID,
    });
    const result = await openEntryPoint("/p/a.dawn");
    expect(invokeMock).toHaveBeenCalledWith(COMMANDS.openEntryPoint, {
      entryPointPath: "/p/a.dawn",
    });
    expect(result.ok && result.value.documentId).toBe(DOCUMENT_ID);
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

describe("payload validation", () => {
  it("rejects a payload with a missing field as invalidCommandResponse", async () => {
    invokeMock.mockResolvedValue({
      ...rawProjectSnapshot,
      documents: undefined,
    });
    const result = await openProject("/p");
    expectFailure(result, "invalidCommandResponse");
    if (!result.ok) expect(result.error.detail).toContain("payload.documents");
  });

  it("rejects unknown enum values in the payload", async () => {
    invokeMock.mockResolvedValue({
      ...rawProjectSnapshot,
      issues: [{ ...rawIssue, kind: "somethingNew" }],
    });
    expectFailure(await openProject("/p"), "invalidCommandResponse");
  });

  it("re-validates entities with the domain parsers", async () => {
    invokeMock.mockResolvedValue({
      ...rawProjectSnapshot,
      project: { ...rawProject, projectId: "not-an-id" },
    });
    expectFailure(await openProject("/p"), "invalidEntityId");

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
      "ioError",
      "entityNotFound",
      "invalidContentExtension",
      "duplicateId",
    ]) {
      invokeMock.mockRejectedValueOnce({ kind, detail: "d" });
      const result = await openProject("/p");
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
      const result = await openProject("/p");
      expectFailure(result, "unexpectedCommandError");
    }
    invokeMock.mockRejectedValueOnce("plain string");
    const result = await openProject("/p");
    expect(!result.ok && result.error.detail).toBe("plain string");
  });
});
