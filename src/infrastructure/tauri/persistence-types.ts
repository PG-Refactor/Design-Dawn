import type { Document } from "../../domain/document/document";
import type { Project } from "../../domain/project/project";
import type { DocumentId, SheetId } from "../../domain/shared/entity-id";
import type { Sheet } from "../../domain/sheet/sheet";
import type { EntityState, LoadIssueKind } from "./command-constants";

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
