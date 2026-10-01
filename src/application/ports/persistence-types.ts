// Shapes the persistence port hands to the application (docs/architecture.md §6.2.1).
// They live here so the application layer can name them without importing
// infrastructure; `infrastructure/tauri/persistence-types.ts` re-exports them unchanged.

import type { Document } from "../../domain/document/document";
import type { Project } from "../../domain/project/project";
import type { DocumentId, SheetId } from "../../domain/shared/entity-id";
import type { Sheet } from "../../domain/sheet/sheet";

// `status` values of a folder selection result.
export const FOLDER_SELECTION_STATUS = {
  selected: "selected",
  cancelled: "cancelled",
} as const;

export const LOAD_ISSUE_KINDS = [
  "unlistedEntity",
  "missingEntity",
  "invalidOrderEntry",
  "duplicateEntityId",
  "entityLoadFailed",
  "missingContent",
  "orphanContent",
  "leftoverTempFile",
  "unrecognizedDirectory",
] as const;

export type LoadIssueKind = (typeof LOAD_ISSUE_KINDS)[number];

export const ENTITY_STATES = ["loaded", "loadFailed"] as const;
export type EntityState = (typeof ENTITY_STATES)[number];

// A warning or error found while loading (docs/data-model.md §7).
export interface LoadIssue {
  readonly kind: LoadIssueKind;
  // Project-root-relative path for display; not a handle to use with commands.
  readonly path: string | null;
  readonly entityId: string | null;
  readonly detail: string;
}

export interface DocumentEntry {
  readonly documentId: DocumentId;
  readonly name: string | null;
  readonly state: EntityState;
}

// `project.documentOrder` is the effective order (unlisted appended, missing dropped).
export interface ProjectSnapshot {
  readonly project: Project;
  readonly documents: readonly DocumentEntry[];
  readonly issues: readonly LoadIssue[];
}

// `selectionId` is an opaque handle for open_project / create_project. `displayPath` is for
// display only and is never sent back to Rust.
export type FolderSelection =
  | {
      readonly status: "selected";
      readonly selectionId: string;
      readonly displayPath: string;
    }
  | { readonly status: "cancelled" };

export interface SheetSnapshot {
  readonly sheetId: SheetId;
  readonly name: string | null;
  readonly state: EntityState;
  // Present exactly when `state` is "loaded".
  readonly sheet: Sheet | null;
}

// `document.sheetOrder` is the effective order.
export interface DocumentSnapshot {
  readonly document: Document;
  readonly sheets: readonly SheetSnapshot[];
  readonly issues: readonly LoadIssue[];
}

export interface SaveResult {
  // False when the file already held the same bytes and was left untouched.
  readonly written: boolean;
}
