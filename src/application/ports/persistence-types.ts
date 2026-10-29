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
  // Which read of the Project this is. Change notifications carry the same number, so one
  // made for an earlier read (before a reload or reopen) is recognized and dropped
  // (docs/architecture.md §14.4).
  readonly sessionGeneration: number;
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

// --- External changes (docs/architecture.md §14.4) ---

export const BLOCK_COMPARISON_OUTCOMES = [
  "identical",
  "text",
  "removedOnDisk",
  "notUtf8",
  "tooLarge",
] as const;

// How a Block's text in memory differs from its file on disk. `diff` is a unified diff with
// the disk as the old side ("---") and the memory as the new side ("+++"), the shape the Git
// diff view reads.
export type BlockContentComparison =
  | { readonly outcome: "identical" }
  | { readonly outcome: "text"; readonly diff: string }
  | { readonly outcome: "removedOnDisk" }
  | { readonly outcome: "notUtf8" }
  | { readonly outcome: "tooLarge"; readonly limitBytes: number };

export const FILE_CHANGE_KINDS = ["modified", "removed"] as const;
export type FileChangeKind = (typeof FILE_CHANGE_KINDS)[number];

// One file that no longer matches what the app last read or wrote. `path` is relative to the
// Document root (for a Document) or to the Project root (for the Project level), never absolute.
export interface ChangedFile {
  readonly path: string;
  readonly change: FileChangeKind;
  // The new content can be read back (valid UTF-8, valid JSON for metadata). A removed file
  // is not readable. A reload happens by itself only when everything that changed is.
  readonly readable: boolean;
}

export interface DocumentFileChanges {
  readonly documentId: DocumentId;
  readonly files: readonly ChangedFile[];
}

// `project.json`, `folder.json` files, and whether the set of Documents / Folders on disk
// differs from what the app knows.
export interface ProjectFileChanges {
  readonly structure: boolean;
  readonly files: readonly ChangedFile[];
}

// The result of `checkExternalChanges` and the payload of the `projectFilesChanged`
// notification. Only open Documents are listed.
export interface ExternalChanges {
  readonly sessionGeneration: number;
  // The file watcher runs for this Project. When it does not, changes are only found by the
  // checks the app asks for (window focus), which the user is told once.
  readonly watching: boolean;
  // The report covers everything (a full comparison) and not just the files an event named.
  readonly rescan: boolean;
  readonly project: ProjectFileChanges;
  readonly documents: readonly DocumentFileChanges[];
}

export const ENTRY_POINT_RESOLUTIONS = ["path", "idScan"] as const;
export type EntryPointResolution = (typeof ENTRY_POINT_RESOLUTIONS)[number];

// A request from outside the app (a `.dawn` passed at launch, or a Project folder chosen for
// "open in a new window") that Rust already opened. Carries no path: Rust keeps it
// (docs/architecture.md §11.0.1). A Project folder names no Document: `documentId` and
// `resolution` are null and only the Project is open.
export interface OpenRequestResult {
  readonly snapshot: ProjectSnapshot;
  readonly documentId: DocumentId | null;
  readonly resolution: EntryPointResolution | null;
}

// `status` values of the "open in a new window" result.
export const OPEN_IN_NEW_WINDOW_STATUS = {
  openedInNewWindow: "openedInNewWindow",
  focusedExisting: "focusedExisting",
} as const;

// A window was created for the Project, or a window already had it and was brought forward
// (`inThisWindow`: it is the window that asked). No window label or path.
export type OpenInNewWindowResult =
  | { readonly status: typeof OPEN_IN_NEW_WINDOW_STATUS.openedInNewWindow }
  | {
      readonly status: typeof OPEN_IN_NEW_WINDOW_STATUS.focusedExisting;
      readonly inThisWindow: boolean;
    };

export interface SaveResult {
  // False when the file already held the same bytes and was left untouched.
  readonly written: boolean;
}
