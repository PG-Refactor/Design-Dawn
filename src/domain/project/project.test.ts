import { describe, expect, it } from "vitest";
import { parseDisplayName } from "../shared/display-name";
import { parseDocumentId, parseFolderId } from "../shared/entity-id";
import { unwrap } from "../shared/test-support";
import {
  addDocument,
  moveDocument,
  parseProject,
  removeDocument,
  renameProject,
} from "./project";

const PROJECT_ID = "01928f3a-5b6c-7d8e-9f01-23456789abcd";
const DOCUMENT_ID_PREFIX = "01928f3a-6c7d-7e8f-a012-3456789abcd";
const documentId = (suffix: string) =>
  unwrap(parseDocumentId(`${DOCUMENT_ID_PREFIX}${suffix}`));

describe("project operations", () => {
  const project = unwrap(
    parseProject({
      schemaVersion: 2,
      projectId: PROJECT_ID,
      name: "Project",
      childOrder: [`${DOCUMENT_ID_PREFIX}0`, `${DOCUMENT_ID_PREFIX}1`],
    }),
  );

  it("renames", () => {
    expect(
      unwrap(renameProject(project, unwrap(parseDisplayName("New")))).name,
    ).toBe("New");
  });

  it("adds, removes and moves documents through childOrder", () => {
    const added = unwrap(addDocument(project, documentId("2")));
    expect(added.childOrder).toHaveLength(3);
    const moved = unwrap(moveDocument(added, documentId("0"), null));
    expect(moved.childOrder).toEqual([
      `${DOCUMENT_ID_PREFIX}1`,
      `${DOCUMENT_ID_PREFIX}2`,
      `${DOCUMENT_ID_PREFIX}0`,
    ]);
    const removed = unwrap(removeDocument(moved, documentId("1")));
    expect(removed.childOrder).toEqual([
      `${DOCUMENT_ID_PREFIX}2`,
      `${DOCUMENT_ID_PREFIX}0`,
    ]);
  });

  it("reports duplicate and missing documents", () => {
    const duplicate = addDocument(project, documentId("0"));
    const missing = removeDocument(project, documentId("9"));
    expect(!duplicate.ok && duplicate.error.kind).toBe("duplicateId");
    expect(!missing.ok && missing.error.kind).toBe("entityNotFound");
  });
});

describe("project child order", () => {
  const folderId = "01928f3a-2000-7000-8000-000000000001";
  const project = unwrap(
    parseProject({
      schemaVersion: 2,
      projectId: PROJECT_ID,
      name: "Project",
      childOrder: [folderId, `${DOCUMENT_ID_PREFIX}0`],
    }),
  );

  it("holds Folder and Document IDs together", () => {
    expect(project.childOrder).toEqual([folderId, `${DOCUMENT_ID_PREFIX}0`]);
  });

  it("moves a Document in front of a Folder entry", () => {
    const moved = unwrap(
      moveDocument(project, documentId("0"), parseFolderIdOrThrow(folderId)),
    );
    expect(moved.childOrder).toEqual([`${DOCUMENT_ID_PREFIX}0`, folderId]);
  });

  it("rejects an ID listed twice across kinds", () => {
    const duplicate = parseProject({
      schemaVersion: 2,
      projectId: PROJECT_ID,
      name: "Project",
      childOrder: [folderId, folderId],
    });
    expect(!duplicate.ok && duplicate.error.kind).toBe("duplicateId");
  });

  it("still reads schemaVersion 1 and rejects a newer one", () => {
    const raw = { projectId: PROJECT_ID, name: "P", childOrder: [] };
    expect(parseProject({ ...raw, schemaVersion: 1 }).ok).toBe(true);
    const newer = parseProject({ ...raw, schemaVersion: 3 });
    expect(!newer.ok && newer.error.kind).toBe("unsupportedSchemaVersion");
  });
});

function parseFolderIdOrThrow(value: string) {
  return unwrap(parseFolderId(value));
}
