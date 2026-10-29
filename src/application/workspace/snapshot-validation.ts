// Re-validates what the persistence port returned through the Domain parsers and checks
// that the pieces agree with each other. The Tauri adapter already parses its payloads;
// this keeps the workspace correct for any gateway, and a snapshot that is inconsistent
// is rejected as a whole instead of half-applied.

import type { Document } from "../../domain/document/document";
import { parseDocument } from "../../domain/document/document";
import type { Project } from "../../domain/project/project";
import { parseProject } from "../../domain/project/project";
import {
  type DocumentId,
  type FolderId,
  parseDocumentId,
  parseFolderId,
  parseSheetId,
  type SheetId,
} from "../../domain/shared/entity-id";
import { findDuplicate } from "../../domain/shared/ordered-ids";
import { parseSheet, type Sheet } from "../../domain/sheet/sheet";
import {
  failWith,
  fromDomainResult,
  type OperationResult,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import type {
  DocumentEntry,
  DocumentSnapshot,
  FolderEntry,
  LoadIssue,
  ProjectSnapshot,
  SheetSnapshot,
} from "../ports/persistence-types";
import type { SheetEntry } from "../state/application-state";

export interface ValidProjectSnapshot {
  readonly project: Project;
  readonly sessionGeneration: number;
  readonly folders: readonly FolderEntry[];
  readonly documents: readonly DocumentEntry[];
  readonly issues: readonly LoadIssue[];
}

// The folder tree must be a forest: every parent exists and following parents never
// loops. A snapshot that violates this cannot be shown, so it is rejected as a whole.
function validateFolderTree(
  folders: readonly FolderEntry[],
  documents: readonly DocumentEntry[],
): OperationResult<void> {
  const parentOf = new Map<FolderId, FolderId | null>();
  for (const folder of folders) {
    const folderId = fromDomainResult(parseFolderId(folder.folderId));
    if (!folderId.ok) return failWith(folderId.error);
    parentOf.set(folder.folderId, folder.parentFolderId);
  }
  const duplicate = findDuplicate([
    ...folders.map((entry) => entry.folderId as string),
    ...documents.map((entry) => entry.documentId as string),
  ]);
  if (duplicate !== null) {
    return operationErr("duplicateId", `duplicate project entry: ${duplicate}`);
  }
  const parents = [
    ...folders.map((entry) => entry.parentFolderId),
    ...documents.map((entry) => entry.parentFolderId),
  ];
  for (const parent of parents) {
    if (parent !== null && !parentOf.has(parent)) {
      return operationErr(
        "invalidCommandResponse",
        `unknown parent folder: ${parent}`,
      );
    }
  }
  for (const start of parentOf.keys()) {
    const visited = new Set<FolderId>();
    let current: FolderId | null = start;
    while (current !== null) {
      if (visited.has(current)) {
        return operationErr(
          "invalidCommandResponse",
          `folder ${start} is its own ancestor`,
        );
      }
      visited.add(current);
      current = parentOf.get(current) ?? null;
    }
  }
  return operationOk(undefined);
}

export function validateProjectSnapshot(
  snapshot: ProjectSnapshot,
): OperationResult<ValidProjectSnapshot> {
  const project = fromDomainResult(parseProject(snapshot.project));
  if (!project.ok) return failWith(project.error);
  for (const entry of snapshot.documents) {
    const documentId = fromDomainResult(parseDocumentId(entry.documentId));
    if (!documentId.ok) return failWith(documentId.error);
  }
  const tree = validateFolderTree(snapshot.folders, snapshot.documents);
  if (!tree.ok) return tree;
  return operationOk({
    project: project.value,
    sessionGeneration: snapshot.sessionGeneration,
    folders: snapshot.folders,
    documents: snapshot.documents,
    issues: snapshot.issues,
  });
}

export interface ValidDocumentSnapshot {
  readonly document: Document;
  // Only sheets that loaded; these are the editable ones.
  readonly sheets: ReadonlyMap<SheetId, Sheet>;
  // Sheets that did not load: listed, never editable.
  readonly failedSheets: readonly SheetEntry[];
  readonly issues: readonly LoadIssue[];
}

// "loaded" and a present sheet must agree, and the ids must be the requested ones.
function validateSheetEntry(
  entry: SheetSnapshot,
): OperationResult<Sheet | null> {
  const sheetId = fromDomainResult(parseSheetId(entry.sheetId));
  if (!sheetId.ok) return failWith(sheetId.error);
  if ((entry.state === "loaded") !== (entry.sheet !== null)) {
    return operationErr(
      "invalidCommandResponse",
      `sheet ${entry.sheetId}: state ${entry.state} does not match the presence of its data`,
    );
  }
  if (entry.sheet === null) return operationOk(null);
  const sheet = fromDomainResult(parseSheet(entry.sheet));
  if (!sheet.ok) return failWith(sheet.error);
  if (sheet.value.sheetId !== entry.sheetId) {
    return operationErr(
      "invalidCommandResponse",
      `sheet entry ${entry.sheetId} carries sheet ${sheet.value.sheetId}`,
    );
  }
  return operationOk(sheet.value);
}

export function validateDocumentSnapshot(
  snapshot: DocumentSnapshot,
  expectedDocumentId: DocumentId,
): OperationResult<ValidDocumentSnapshot> {
  const document = fromDomainResult(parseDocument(snapshot.document));
  if (!document.ok) return failWith(document.error);
  if (document.value.documentId !== expectedDocumentId) {
    return operationErr(
      "invalidCommandResponse",
      `requested document ${expectedDocumentId} but received ${document.value.documentId}`,
    );
  }
  const duplicate = findDuplicate(
    snapshot.sheets.map((entry) => entry.sheetId),
  );
  if (duplicate !== null) {
    return operationErr("duplicateId", `duplicate sheet entry: ${duplicate}`);
  }
  const sheets = new Map<SheetId, Sheet>();
  const failedSheets: SheetEntry[] = [];
  for (const entry of snapshot.sheets) {
    const sheet = validateSheetEntry(entry);
    if (!sheet.ok) return failWith(sheet.error);
    if (sheet.value === null) {
      failedSheets.push({
        sheetId: entry.sheetId,
        name: entry.name,
        state: entry.state,
      });
    } else {
      sheets.set(sheet.value.sheetId, sheet.value);
    }
  }
  return operationOk({
    document: document.value,
    sheets,
    failedSheets,
    issues: snapshot.issues,
  });
}

export function validateSheetSnapshot(
  snapshot: SheetSnapshot,
  expectedSheetId: SheetId,
): OperationResult<Sheet> {
  const sheet = validateSheetEntry(snapshot);
  if (!sheet.ok) return failWith(sheet.error);
  if (sheet.value === null || sheet.value.sheetId !== expectedSheetId) {
    return operationErr(
      "invalidCommandResponse",
      `the created sheet is not the requested sheet ${expectedSheetId}`,
    );
  }
  return operationOk(sheet.value);
}
