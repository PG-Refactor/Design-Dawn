import { describe, expect, it } from "vitest";
import type {
  DocumentEntry,
  DocumentSnapshot,
  FolderEntry,
  ProjectSnapshot,
  SheetSnapshot,
} from "../ports/persistence-types";
import {
  DOCUMENT_ID,
  documentIdOf,
  folderIdOf,
  OTHER_SHEET_ID,
  PROJECT_ID,
  SHEET_ID,
} from "../test-support/fakes";
import {
  validateDocumentSnapshot,
  validateProjectSnapshot,
  validateSheetSnapshot,
} from "./snapshot-validation";

const RAW_SHEET = {
  schemaVersion: 2,
  sheetId: SHEET_ID,
  name: "S",
  blocks: [],
} as never;
const BAD_ID = "not-an-id" as never;

function project(
  folders: readonly FolderEntry[],
  documents: readonly DocumentEntry[],
): ProjectSnapshot {
  return {
    project: {
      schemaVersion: 2,
      projectId: PROJECT_ID,
      name: "P",
      childOrder: [],
    } as never,
    sessionGeneration: 1,
    folders,
    documents,
    issues: [],
  };
}

const folder = (
  folderId: FolderEntry["folderId"],
  parentFolderId: FolderEntry["parentFolderId"] = null,
): FolderEntry => ({
  folderId,
  name: "F",
  parentFolderId,
  childOrder: [],
  state: "loaded",
});

const loadedSheet = (
  overrides: Partial<SheetSnapshot> = {},
): SheetSnapshot => ({
  sheetId: SHEET_ID,
  name: "S",
  state: "loaded",
  sheet: RAW_SHEET,
  ...overrides,
});

const documentSnapshot = (
  sheets: readonly SheetSnapshot[],
): DocumentSnapshot => ({
  document: {
    schemaVersion: 1,
    documentId: DOCUMENT_ID,
    name: "Document",
    sheetOrder: [SHEET_ID, OTHER_SHEET_ID],
  } as never,
  sheets,
  issues: [],
});

describe("validateProjectSnapshot", () => {
  it.each<[string, ProjectSnapshot]>([
    ["an invalid project", { ...project([], []), project: {} as never }],
    [
      "an invalid document id",
      project(
        [],
        [
          {
            documentId: BAD_ID,
            parentFolderId: null,
            name: "D",
            state: "loaded",
          },
        ],
      ),
    ],
    ["an invalid folder id", project([folder(BAD_ID)], [])],
    [
      "a folder listed twice",
      project([folder(folderIdOf(1)), folder(folderIdOf(1))], []),
    ],
    ["an unknown parent", project([folder(folderIdOf(1), folderIdOf(2))], [])],
    [
      "a folder that is its own ancestor",
      project(
        [
          folder(folderIdOf(1), folderIdOf(2)),
          folder(folderIdOf(2), folderIdOf(1)),
        ],
        [],
      ),
    ],
  ])("rejects %s", (_what, snapshot) => {
    expect(validateProjectSnapshot(snapshot).ok).toBe(false);
  });

  it("accepts nested folders and a document in one", () => {
    const snapshot = project(
      [folder(folderIdOf(1)), folder(folderIdOf(2), folderIdOf(1))],
      [
        {
          documentId: documentIdOf(3),
          parentFolderId: folderIdOf(2),
          name: "D",
          state: "loaded",
        },
      ],
    );
    expect(validateProjectSnapshot(snapshot).ok).toBe(true);
  });
});

describe("validateDocumentSnapshot", () => {
  it.each<[string, DocumentSnapshot]>([
    ["an invalid document", { ...documentSnapshot([]), document: {} as never }],
    ["a sheet listed twice", documentSnapshot([loadedSheet(), loadedSheet()])],
    [
      "an invalid sheet id",
      documentSnapshot([loadedSheet({ sheetId: BAD_ID })]),
    ],
    [
      "a loaded sheet without data",
      documentSnapshot([loadedSheet({ sheet: null })]),
    ],
    [
      "invalid sheet data",
      documentSnapshot([loadedSheet({ sheet: {} as never })]),
    ],
    [
      "a sheet under another id",
      documentSnapshot([loadedSheet({ sheetId: OTHER_SHEET_ID })]),
    ],
  ])("rejects %s", (_what, snapshot) => {
    expect(validateDocumentSnapshot(snapshot, DOCUMENT_ID).ok).toBe(false);
  });

  it("rejects another document than the one asked for", () => {
    expect(
      validateDocumentSnapshot(documentSnapshot([]), documentIdOf(9)).ok,
    ).toBe(false);
  });
});

describe("validateSheetSnapshot", () => {
  it("rejects an invalid entry, a failed sheet and another sheet", () => {
    expect(
      validateSheetSnapshot(loadedSheet({ sheetId: BAD_ID }), SHEET_ID).ok,
    ).toBe(false);
    expect(
      validateSheetSnapshot(
        loadedSheet({ state: "failed" as never, sheet: null }),
        SHEET_ID,
      ).ok,
    ).toBe(false);
    expect(validateSheetSnapshot(loadedSheet(), OTHER_SHEET_ID).ok).toBe(false);
    expect(validateSheetSnapshot(loadedSheet(), SHEET_ID).ok).toBe(true);
  });
});

describe("an accepted document snapshot", () => {
  it("keeps loaded sheets and lists failed ones", () => {
    const valid = validateDocumentSnapshot(
      documentSnapshot([
        loadedSheet({ sheet: RAW_SHEET }),
        {
          sheetId: OTHER_SHEET_ID,
          name: null,
          state: "loadFailed",
          sheet: null,
        },
      ]),
      DOCUMENT_ID,
    );
    expect(valid.ok && valid.value.sheets.size).toBe(1);
    expect(valid.ok && valid.value.failedSheets).toHaveLength(1);
  });
});
