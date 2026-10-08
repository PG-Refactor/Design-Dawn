// Shapes the persistence port hands to the application (docs/architecture.md §6.2.1).
// They live here so the application layer can name them without importing
// infrastructure; `infrastructure/tauri/persistence-types.ts` re-exports them unchanged.

import type { Document } from "../../domain/document/document";
import type { Project } from "../../domain/project/project";
import type {
  DocumentId,
  EntryId,
  FolderId,
  SheetId,
} from "../../domain/shared/entity-id";
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

// A Folder of the Project. Folders and Documents are listed flat; the tree is rebuilt from
// `parentFolderId` (null = directly under the Project) and each `childOrder`.
export interface FolderEntry {
  readonly folderId: FolderId;
  readonly name: string | null;
  readonly parentFolderId: FolderId | null;
  // Effective order (unlisted appended, missing dropped); empty when the folder failed to
  // load, because its children are not scanned.
  readonly childOrder: readonly EntryId[];
  readonly state: EntityState;
}

// What `create_folder` returns: the same shape as one entry of `ProjectSnapshot.folders`
// (a new folder is "loaded", named, and has an empty `childOrder`).
export type FolderSnapshot = FolderEntry;

export interface DocumentEntry {
  readonly documentId: DocumentId;
  readonly parentFolderId: FolderId | null;
  readonly name: string | null;
  readonly state: EntityState;
}

// `project.childOrder` is the effective order (unlisted appended, missing dropped).
export interface ProjectSnapshot {
  readonly project: Project;
  readonly folders: readonly FolderEntry[];
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

export const ENTRY_POINT_RESOLUTIONS = ["path", "idScan"] as const;
export type EntryPointResolution = (typeof ENTRY_POINT_RESOLUTIONS)[number];

// A request from outside the app (a `.dawn` passed at launch) that Rust already opened.
// Carries no path: Rust keeps it (docs/architecture.md §11.0.1).
export interface OpenRequestResult {
  readonly snapshot: ProjectSnapshot;
  readonly documentId: DocumentId;
  readonly resolution: EntryPointResolution;
}

export interface SaveResult {
  // False when the file already held the same bytes and was left untouched.
  readonly written: boolean;
}
