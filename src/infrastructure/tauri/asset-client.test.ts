import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseContentPath } from "../../domain/block/content-path";
import { parseDocumentId, parseProjectId } from "../../domain/shared/entity-id";
import { unwrap } from "../../domain/shared/test-support";
import { copyAssetToDocument, importDroppedImages } from "./asset-client";
import { COMMANDS } from "./command-constants";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

const PROJECT_ID = "01928f3a-5b6c-7d8e-9f01-23456789abcd";
const DOCUMENT_ID = "01928f3a-6c7d-7e8f-a012-3456789abcde";
const OTHER_DOCUMENT_ID = "01928f3a-0002-7aaa-8bbb-0123456789ab";
const DROP_ID = "01928f3a-aaaa-7bbb-8ccc-0123456789ab";

const projectId = unwrap(parseProjectId(PROJECT_ID));
const documentId = unwrap(parseDocumentId(DOCUMENT_ID));
const otherDocumentId = unwrap(parseDocumentId(OTHER_DOCUMENT_ID));
const contentPath = unwrap(parseContentPath("assets/pixel.png"));

const rawImported = {
  contentPath: "assets/a.png",
  naturalWidth: 1920,
  naturalHeight: 1080,
  initialWidth: 480,
  initialHeight: 270,
  blockType: "image",
};

beforeEach(() => {
  invokeMock.mockReset();
});

describe("importDroppedImages", () => {
  it("sends only ids and decodes imported and rejected files", async () => {
    invokeMock.mockResolvedValueOnce({
      imported: [rawImported],
      rejected: [
        {
          fileName: "bad.png",
          error: { kind: "invalidImageContent", detail: "d" },
        },
      ],
    });

    const result = await importDroppedImages(DROP_ID, projectId, documentId);

    expect(invokeMock.mock.calls).toStrictEqual([
      [
        COMMANDS.importDroppedImages,
        { dropId: DROP_ID, projectId: PROJECT_ID, documentId: DOCUMENT_ID },
      ],
    ]);
    expect(result).toStrictEqual({
      ok: true,
      value: {
        imported: [
          {
            ...rawImported,
            contentPath: unwrap(parseContentPath("assets/a.png")),
          },
        ],
        rejected: [
          {
            fileName: "bad.png",
            error: { kind: "invalidImageContent", detail: "d" },
          },
        ],
      },
    });
  });

  it("maps an expired drop to invalidDropSelection", async () => {
    invokeMock.mockRejectedValueOnce({
      kind: "invalidDropSelection",
      detail: "d",
    });
    const result = await importDroppedImages(DROP_ID, projectId, documentId);
    expect(result).toStrictEqual({
      ok: false,
      error: { kind: "invalidDropSelection", detail: "d" },
    });
  });

  it("rejects a payload with an unknown rejection kind or block type", async () => {
    invokeMock.mockResolvedValueOnce({
      imported: [],
      rejected: [{ fileName: "x", error: { kind: "madeUp", detail: "d" } }],
    });
    const unknownKind = await importDroppedImages(
      DROP_ID,
      projectId,
      documentId,
    );
    expect(!unknownKind.ok && unknownKind.error.kind).toBe(
      "invalidCommandResponse",
    );

    invokeMock.mockResolvedValueOnce({
      imported: [{ ...rawImported, blockType: "video" }],
      rejected: [],
    });
    const unknownType = await importDroppedImages(
      DROP_ID,
      projectId,
      documentId,
    );
    expect(!unknownType.ok && unknownType.error.kind).toBe(
      "unsupportedBlockType",
    );
  });
});

describe("copyAssetToDocument", () => {
  it("sends the four arguments and decodes the copied asset", async () => {
    invokeMock.mockResolvedValueOnce({
      contentPath: "assets/pixel-2.png",
      naturalWidth: 1,
      naturalHeight: 1,
    });

    const result = await copyAssetToDocument(
      projectId,
      documentId,
      contentPath,
      otherDocumentId,
    );

    expect(invokeMock.mock.calls).toStrictEqual([
      [
        COMMANDS.copyAssetToDocument,
        {
          projectId: PROJECT_ID,
          sourceDocumentId: DOCUMENT_ID,
          contentPath: "assets/pixel.png",
          targetDocumentId: OTHER_DOCUMENT_ID,
        },
      ],
    ]);
    expect(result).toStrictEqual({
      ok: true,
      value: {
        contentPath: unwrap(parseContentPath("assets/pixel-2.png")),
        naturalWidth: 1,
        naturalHeight: 1,
      },
    });
  });

  it("rejects a malformed payload", async () => {
    invokeMock.mockResolvedValueOnce({ contentPath: "assets/a.png" });
    const result = await copyAssetToDocument(
      projectId,
      documentId,
      contentPath,
      otherDocumentId,
    );
    expect(!result.ok && result.error.kind).toBe("invalidCommandResponse");
  });
});
