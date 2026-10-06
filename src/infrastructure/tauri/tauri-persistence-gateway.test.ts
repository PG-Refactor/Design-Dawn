import { beforeEach, describe, expect, it, vi } from "vitest";
import { displayName, folderIdOf } from "../../application/test-support/fakes";
import { parseContentPath } from "../../domain/block/content-path";
import { parseFolder } from "../../domain/folder/folder";
import {
  DOCUMENT_ID,
  makeSheetWith,
  PROJECT_ID,
  SHEET_ID,
} from "../../domain/shared/test-fixtures";
import { unwrap } from "../../domain/shared/test-support";
import * as assetClient from "./asset-client";
import * as client from "./persistence-client";
import { createTauriPersistenceGateway } from "./tauri-persistence-gateway";

vi.mock("./persistence-client");
vi.mock("./asset-client");

const contentPath = unwrap(parseContentPath("sheets/s/blocks/markdown-1.md"));
const sheet = makeSheetWith(SHEET_ID, []);
const failure = {
  ok: false,
  error: { kind: "ioError", detail: "disk" },
} as const;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("createTauriPersistenceGateway", () => {
  it("maps saves onto the client and drops the written flag", async () => {
    vi.mocked(client.saveSheet).mockResolvedValue({
      ok: true,
      value: { written: true },
    });
    const result = await createTauriPersistenceGateway().saveSheet(
      PROJECT_ID,
      DOCUMENT_ID,
      sheet,
    );
    expect(client.saveSheet).toHaveBeenCalledWith(
      PROJECT_ID,
      DOCUMENT_ID,
      sheet,
    );
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("maps writeBlockContent onto the client and drops the written flag", async () => {
    vi.mocked(client.writeBlockContent).mockResolvedValue({
      ok: true,
      value: { written: false },
    });
    const gateway = createTauriPersistenceGateway();
    expect(
      await gateway.writeBlockContent(
        PROJECT_ID,
        DOCUMENT_ID,
        contentPath,
        "text",
      ),
    ).toEqual({ ok: true, value: undefined });
    expect(client.writeBlockContent).toHaveBeenCalledWith(
      PROJECT_ID,
      DOCUMENT_ID,
      contentPath,
      "text",
    );
    vi.mocked(client.writeBlockContent).mockResolvedValue(failure);
    expect(
      await gateway.writeBlockContent(
        PROJECT_ID,
        DOCUMENT_ID,
        contentPath,
        "text",
      ),
    ).toEqual(failure);
  });

  it("passes content results through unchanged", async () => {
    vi.mocked(client.createBlockContent).mockResolvedValue({
      ok: true,
      value: contentPath,
    });
    vi.mocked(client.readBlockContent).mockResolvedValue({
      ok: true,
      value: "text",
    });
    const gateway = createTauriPersistenceGateway();
    expect(
      await gateway.createBlockContent(
        PROJECT_ID,
        DOCUMENT_ID,
        SHEET_ID,
        "markdown",
        "t",
      ),
    ).toEqual({ ok: true, value: contentPath });
    expect(client.createBlockContent).toHaveBeenCalledWith(
      PROJECT_ID,
      DOCUMENT_ID,
      SHEET_ID,
      "markdown",
      "t",
    );
    expect(
      await gateway.readBlockContent(PROJECT_ID, DOCUMENT_ID, contentPath),
    ).toEqual({
      ok: true,
      value: "text",
    });
  });

  it("maps delete and restore to void and keeps errors", async () => {
    vi.mocked(client.deleteBlockContent).mockResolvedValue({
      ok: true,
      value: null,
    });
    vi.mocked(client.restoreBlockContent).mockResolvedValue(failure);
    vi.mocked(client.saveDocument).mockResolvedValue(failure);
    const gateway = createTauriPersistenceGateway();
    expect(
      await gateway.deleteBlockContent(PROJECT_ID, DOCUMENT_ID, contentPath),
    ).toEqual({
      ok: true,
      value: undefined,
    });
    expect(
      await gateway.restoreBlockContent(
        PROJECT_ID,
        DOCUMENT_ID,
        "markdown",
        contentPath,
        "t",
      ),
    ).toEqual(failure);
    expect(client.restoreBlockContent).toHaveBeenCalledWith(
      PROJECT_ID,
      DOCUMENT_ID,
      "markdown",
      contentPath,
      "t",
    );
  });

  it("maps project, document and sheet operations onto the client", async () => {
    vi.mocked(client.saveProject).mockResolvedValue({
      ok: true,
      value: { written: false },
    });
    vi.mocked(client.deleteSheet).mockResolvedValue({ ok: true, value: null });
    vi.mocked(client.deleteDocument).mockResolvedValue(failure);
    vi.mocked(client.closeDocument).mockResolvedValue({
      ok: true,
      value: null,
    });
    vi.mocked(client.selectProjectFolder).mockResolvedValue({
      ok: true,
      value: { status: "cancelled" },
    });
    const gateway = createTauriPersistenceGateway();
    expect(await gateway.selectProjectFolder()).toEqual({
      ok: true,
      value: { status: "cancelled" },
    });
    expect(
      await gateway.deleteSheet(PROJECT_ID, DOCUMENT_ID, SHEET_ID),
    ).toEqual({ ok: true, value: undefined });
    expect(await gateway.deleteDocument(PROJECT_ID, DOCUMENT_ID)).toEqual(
      failure,
    );
    expect(await gateway.closeDocument(PROJECT_ID, DOCUMENT_ID)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(client.closeDocument).toHaveBeenCalledWith(PROJECT_ID, DOCUMENT_ID);
    expect(client.deleteSheet).toHaveBeenCalledWith(
      PROJECT_ID,
      DOCUMENT_ID,
      SHEET_ID,
    );
    expect(client.saveProject).not.toHaveBeenCalled();
  });

  it("maps the asset operations onto the asset client unchanged", async () => {
    const dropResult = {
      ok: true,
      value: { imported: [], rejected: [] },
    } as const;
    vi.mocked(assetClient.importDroppedImages).mockResolvedValue(dropResult);
    const gateway = createTauriPersistenceGateway();
    expect(
      await gateway.importDroppedImages("drop", PROJECT_ID, DOCUMENT_ID),
    ).toBe(dropResult);
    expect(assetClient.importDroppedImages).toHaveBeenCalledWith(
      "drop",
      PROJECT_ID,
      DOCUMENT_ID,
    );
    const copied = {
      ok: true,
      value: { contentPath, naturalWidth: 1, naturalHeight: 1 },
    } as const;
    vi.mocked(assetClient.copyAssetToDocument).mockResolvedValue(copied);
    expect(
      await gateway.copyAssetToDocument(
        PROJECT_ID,
        DOCUMENT_ID,
        contentPath,
        DOCUMENT_ID,
      ),
    ).toBe(copied);
  });

  it("maps the folder operations onto the client and drops void / written results", async () => {
    const gateway = createTauriPersistenceGateway();
    const folderId = folderIdOf(1);
    const parentId = folderIdOf(2);
    const name = displayName("Folder");
    const created = {
      ok: true,
      value: {
        folderId,
        name: "Folder",
        parentFolderId: null,
        childOrder: [],
        state: "loaded",
      },
    } as const;
    vi.mocked(client.createFolder).mockResolvedValue(created);
    expect(await gateway.createFolder(PROJECT_ID, null, folderId, name)).toBe(
      created,
    );
    expect(client.createFolder).toHaveBeenCalledWith(
      PROJECT_ID,
      null,
      folderId,
      name,
    );

    vi.mocked(client.moveEntry).mockResolvedValue({ ok: true, value: null });
    expect(await gateway.moveEntry(PROJECT_ID, DOCUMENT_ID, parentId)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(client.moveEntry).toHaveBeenCalledWith(
      PROJECT_ID,
      DOCUMENT_ID,
      parentId,
    );
    vi.mocked(client.moveEntry).mockResolvedValue({
      ok: false,
      error: { kind: "invalidMove", detail: "d" },
    });
    expect(await gateway.moveEntry(PROJECT_ID, DOCUMENT_ID, null)).toEqual({
      ok: false,
      error: { kind: "invalidMove", detail: "d" },
    });

    vi.mocked(client.deleteFolder).mockResolvedValue({ ok: true, value: null });
    expect(await gateway.deleteFolder(PROJECT_ID, folderId)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(client.deleteFolder).toHaveBeenCalledWith(PROJECT_ID, folderId);

    const folder = unwrap(
      parseFolder({
        schemaVersion: 1,
        folderId,
        name: "Folder",
        childOrder: [],
      }),
    );
    vi.mocked(client.saveFolder).mockResolvedValue({
      ok: true,
      value: { written: true },
    });
    expect(await gateway.saveFolder(PROJECT_ID, folder)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(client.saveFolder).toHaveBeenCalledWith(PROJECT_ID, folder);
  });

  it("passes the parent folder through when creating a document", async () => {
    vi.mocked(client.createDocument).mockResolvedValue(failure);
    const gateway = createTauriPersistenceGateway();
    const parentId = folderIdOf(2);
    await gateway.createDocument(
      PROJECT_ID,
      DOCUMENT_ID,
      displayName("Doc"),
      parentId,
    );
    expect(client.createDocument).toHaveBeenCalledWith(
      PROJECT_ID,
      DOCUMENT_ID,
      displayName("Doc"),
      parentId,
    );
  });
});
