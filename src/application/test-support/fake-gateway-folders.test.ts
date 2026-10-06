// The fake gateway has to apply the same folder rules as Rust (docs/architecture.md §6.2.4)
// at a basic level, so Workspace tests can rely on it.

import { describe, expect, it } from "vitest";
import { parseFolder } from "../../domain/folder/folder";
import { DOCUMENT_ID, PROJECT_ID } from "../../domain/shared/test-fixtures";
import { unwrap } from "../../domain/shared/test-support";
import {
  createFakeGateway,
  displayName,
  documentIdOf,
  folderIdOf,
} from "./fakes";

const FOLDER_A = folderIdOf(1);
const FOLDER_B = folderIdOf(2);
const FOLDER_C = folderIdOf(3);

function errorKindOf<T>(
  result: { ok: true; value: T } | { ok: false; error: { kind: string } },
) {
  return result.ok ? null : result.error.kind;
}

describe("fake gateway folders", () => {
  it("creates folders and documents inside loaded folders only", async () => {
    const gateway = createFakeGateway();
    const created = await gateway.createFolder(
      PROJECT_ID,
      null,
      FOLDER_A,
      displayName("A"),
    );
    expect(created).toEqual({
      ok: true,
      value: {
        folderId: FOLDER_A,
        name: "A",
        parentFolderId: null,
        childOrder: [],
        state: "loaded",
      },
    });
    expect(
      errorKindOf(
        await gateway.createFolder(
          PROJECT_ID,
          null,
          FOLDER_A,
          displayName("A"),
        ),
      ),
    ).toBe("duplicateId");
    expect(
      errorKindOf(
        await gateway.createFolder(
          PROJECT_ID,
          FOLDER_C,
          FOLDER_B,
          displayName("B"),
        ),
      ),
    ).toBe("entityNotFound");
    gateway.seedFolder({ folderId: FOLDER_C, state: "loadFailed" });
    expect(
      errorKindOf(
        await gateway.createFolder(
          PROJECT_ID,
          FOLDER_C,
          FOLDER_B,
          displayName("B"),
        ),
      ),
    ).toBe("notWritable");

    await gateway.createDocument(
      PROJECT_ID,
      DOCUMENT_ID,
      displayName("Doc"),
      FOLDER_A,
    );
    expect(gateway.disk.documentParents.get(DOCUMENT_ID)).toBe(FOLDER_A);
  });

  it("saves a folder's name and order, and refuses unknown or failed folders", async () => {
    const gateway = createFakeGateway();
    gateway.seedFolder({ folderId: FOLDER_A });
    gateway.seedFolder({ folderId: FOLDER_C, state: "loadFailed" });
    const folder = unwrap(
      parseFolder({
        schemaVersion: 1,
        folderId: FOLDER_A,
        name: "Renamed",
        childOrder: [DOCUMENT_ID],
      }),
    );
    expect((await gateway.saveFolder(PROJECT_ID, folder)).ok).toBe(true);
    expect(gateway.disk.folders.get(FOLDER_A)?.folder).toBe(folder);
    expect(
      errorKindOf(
        await gateway.saveFolder(PROJECT_ID, { ...folder, folderId: FOLDER_B }),
      ),
    ).toBe("entityNotFound");
    expect(
      errorKindOf(
        await gateway.saveFolder(PROJECT_ID, { ...folder, folderId: FOLDER_C }),
      ),
    ).toBe("notWritable");
  });

  it("moves closed entries and rejects self, descendant and open moves", async () => {
    const gateway = createFakeGateway();
    gateway.seedFolder({ folderId: FOLDER_A });
    gateway.seedFolder({ folderId: FOLDER_B, parentFolderId: FOLDER_A });
    gateway.seedFolder({ folderId: FOLDER_C });
    gateway.seedDocument({ documentId: DOCUMENT_ID });

    for (const [entry, target] of [
      [FOLDER_A, FOLDER_A],
      [FOLDER_A, FOLDER_B],
    ] as const) {
      expect(
        errorKindOf(await gateway.moveEntry(PROJECT_ID, entry, target)),
      ).toBe("invalidMove");
    }
    expect(
      errorKindOf(
        await gateway.moveEntry(PROJECT_ID, folderIdOf(99), FOLDER_A),
      ),
    ).toBe("entityNotFound");
    expect(
      errorKindOf(
        await gateway.moveEntry(PROJECT_ID, DOCUMENT_ID, folderIdOf(99)),
      ),
    ).toBe("entityNotFound");

    expect(
      (await gateway.moveEntry(PROJECT_ID, DOCUMENT_ID, FOLDER_B)).ok,
    ).toBe(true);
    expect(gateway.disk.documentParents.get(DOCUMENT_ID)).toBe(FOLDER_B);

    // An opened document pins itself and every folder above it.
    await gateway.loadDocument(PROJECT_ID, DOCUMENT_ID);
    for (const entry of [DOCUMENT_ID, FOLDER_B, FOLDER_A]) {
      expect(
        errorKindOf(await gateway.moveEntry(PROJECT_ID, entry, FOLDER_C)),
      ).toBe("invalidMove");
    }
    await gateway.closeDocument(PROJECT_ID, DOCUMENT_ID);
    expect((await gateway.moveEntry(PROJECT_ID, FOLDER_A, FOLDER_C)).ok).toBe(
      true,
    );
    expect((await gateway.moveEntry(PROJECT_ID, DOCUMENT_ID, null)).ok).toBe(
      true,
    );
    expect(gateway.disk.documentParents.has(DOCUMENT_ID)).toBe(false);
  });

  it("deletes only empty folders", async () => {
    const gateway = createFakeGateway();
    gateway.seedFolder({ folderId: FOLDER_A });
    gateway.seedFolder({ folderId: FOLDER_B, parentFolderId: FOLDER_A });
    expect(errorKindOf(await gateway.deleteFolder(PROJECT_ID, FOLDER_A))).toBe(
      "folderNotEmpty",
    );
    expect((await gateway.deleteFolder(PROJECT_ID, FOLDER_B)).ok).toBe(true);
    expect((await gateway.deleteFolder(PROJECT_ID, FOLDER_A)).ok).toBe(true);
    expect(errorKindOf(await gateway.deleteFolder(PROJECT_ID, FOLDER_A))).toBe(
      "entityNotFound",
    );
    const documentId = documentIdOf(5);
    gateway.seedFolder({ folderId: FOLDER_A });
    await gateway.createDocument(
      PROJECT_ID,
      documentId,
      displayName("Doc"),
      FOLDER_A,
    );
    expect(errorKindOf(await gateway.deleteFolder(PROJECT_ID, FOLDER_A))).toBe(
      "folderNotEmpty",
    );
  });
});
