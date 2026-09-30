import { describe, expect, it } from "vitest";
import { parseDisplayName } from "../shared/display-name";
import { parseDocumentId } from "../shared/entity-id";
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
      schemaVersion: 1,
      projectId: PROJECT_ID,
      name: "Project",
      documentOrder: [`${DOCUMENT_ID_PREFIX}0`, `${DOCUMENT_ID_PREFIX}1`],
    }),
  );

  it("renames", () => {
    expect(
      unwrap(renameProject(project, unwrap(parseDisplayName("New")))).name,
    ).toBe("New");
  });

  it("adds, removes and moves documents through documentOrder", () => {
    const added = unwrap(addDocument(project, documentId("2")));
    expect(added.documentOrder).toHaveLength(3);
    const moved = unwrap(moveDocument(added, documentId("0"), null));
    expect(moved.documentOrder).toEqual([
      `${DOCUMENT_ID_PREFIX}1`,
      `${DOCUMENT_ID_PREFIX}2`,
      `${DOCUMENT_ID_PREFIX}0`,
    ]);
    const removed = unwrap(removeDocument(moved, documentId("1")));
    expect(removed.documentOrder).toEqual([
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
