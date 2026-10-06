// Application / Domain State (docs/architecture.md §8.1): the open project, the open
// documents' immutable Domain values, history flags and save state. No UI concerns
// (selection, viewport, hover) belong here.

import type { Document } from "../../domain/document/document";
import type { Project } from "../../domain/project/project";
import type {
  BlockId,
  DocumentId,
  EntryId,
  FolderId,
  ProjectId,
  SheetId,
} from "../../domain/shared/entity-id";
import type { Sheet } from "../../domain/sheet/sheet";
import { createStore, type Store } from "../../shared/store/store";
import type { CommandKind } from "../commands/command-kind";
import type { OperationWarning } from "../operation-warning";
import type { OperationError } from "../ports/operation-error";
import type { EntityState, LoadIssue } from "../ports/persistence-types";

export interface HistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: CommandKind | null;
  readonly redoLabel: CommandKind | null;
}

export interface SaveState {
  readonly dirtySheetIds: ReadonlySet<SheetId>;
  // Blocks whose text changed since it was last written to its content file.
  readonly dirtyContentBlockIds: ReadonlySet<BlockId>;
  readonly documentDirty: boolean;
  readonly saving: boolean;
  // Set when the last save attempt failed; cleared by the next successful save.
  readonly lastError: OperationError | null;
}

// Where reading a block's text stands. A block without an entry has not been requested.
export type ContentLoadStatus =
  | { readonly status: "loading" }
  | { readonly status: "loaded" }
  | { readonly status: "failed"; readonly error: OperationError };

export interface DocumentSessionState {
  readonly document: Document;
  readonly sheets: ReadonlyMap<SheetId, Sheet>;
  // Texts of the blocks whose status is "loaded" (see `DocumentData.contents`).
  readonly contents: ReadonlyMap<BlockId, string>;
  readonly contentStatus: ReadonlyMap<BlockId, ContentLoadStatus>;
  readonly history: HistoryState;
  readonly save: SaveState;
  // Non-fatal problems of the most recent operation (for example a content file that
  // could not be deleted after the sheet was saved). Reset when the next operation starts.
  readonly warnings: readonly OperationWarning[];
}

export interface OpenProjectFolderEntry {
  readonly folderId: FolderId;
  // null when the folder failed to load and its name is unknown.
  readonly name: string | null;
  // null = directly under the Project.
  readonly parentFolderId: FolderId | null;
  readonly childOrder: readonly EntryId[];
  readonly state: EntityState;
  // Like `OpenProjectState.save`, for this folder's own file (name, childOrder).
  readonly save: ProjectSaveState;
}

export interface OpenProjectDocumentEntry {
  readonly documentId: DocumentId;
  // null = directly under the Project.
  readonly parentFolderId: FolderId | null;
  // null when the document failed to load and its name is unknown. For an open document
  // the name follows `renameDocument` commands.
  readonly name: string | null;
  readonly state: EntityState;
}

// Mirrors the document save state: the project's own files (name, childOrder) are
// saved explicitly, not by a timer, so a failed save stays visible until it is retried.
export interface ProjectSaveState {
  readonly dirty: boolean;
  readonly lastError: OperationError | null;
}

export interface OpenProjectState {
  readonly projectId: ProjectId;
  readonly project: Project;
  // Every Folder of the Project, flat; the tree follows `parentFolderId` and `childOrder`.
  readonly folders: readonly OpenProjectFolderEntry[];
  // Every Document of the Project, including those inside Folders.
  readonly documents: readonly OpenProjectDocumentEntry[];
  readonly issues: readonly LoadIssue[];
  readonly save: ProjectSaveState;
}

// A sheet of an open document. Sheets that failed to load are listed here but are not
// in `DocumentSessionState.sheets`, so they cannot be edited.
export interface SheetEntry {
  readonly sheetId: SheetId;
  readonly name: string | null;
  readonly state: EntityState;
}

// Facts about an open document that are not part of its editable Domain values.
export interface OpenDocumentDetails {
  readonly sheetEntries: readonly SheetEntry[];
  readonly issues: readonly LoadIssue[];
}

export interface ApplicationState {
  readonly project: OpenProjectState | null;
  readonly documents: ReadonlyMap<DocumentId, DocumentSessionState>;
  // Sibling of `documents` (same keys): the session state stays exactly what the
  // document session publishes.
  readonly documentDetails: ReadonlyMap<DocumentId, OpenDocumentDetails>;
}

export type ApplicationStore = Store<ApplicationState>;

export function createInitialApplicationState(): ApplicationState {
  return { project: null, documents: new Map(), documentDetails: new Map() };
}

export function createApplicationStore(): ApplicationStore {
  return createStore(createInitialApplicationState());
}

export function setOpenProject(
  state: ApplicationState,
  project: OpenProjectState | null,
): ApplicationState {
  return state.project === project ? state : { ...state, project };
}

// Adds or replaces the session state of a document.
export function putDocumentSession(
  state: ApplicationState,
  documentState: DocumentSessionState,
): ApplicationState {
  const documents = new Map(state.documents);
  documents.set(documentState.document.documentId, documentState);
  return { ...state, documents };
}

// Replaces only a document that is still open, so a late notification from a session
// that was just closed cannot bring the document back. Also keeps what is derived from
// the session state in step: the sheet entries (names follow `renameSheet`) and the
// project's document entry name (follows `renameDocument`).
export function replaceDocumentSession(
  state: ApplicationState,
  documentState: DocumentSessionState,
): ApplicationState {
  const documentId = documentState.document.documentId;
  if (!state.documents.has(documentId)) return state;
  return syncDerivedDocumentState(
    putDocumentSession(state, documentState),
    documentState,
  );
}

function syncDerivedDocumentState(
  state: ApplicationState,
  documentState: DocumentSessionState,
): ApplicationState {
  const documentId = documentState.document.documentId;
  let next = state;
  const details = state.documentDetails.get(documentId);
  if (details !== undefined) {
    const sheetEntries = syncSheetEntries(details.sheetEntries, documentState);
    if (sheetEntries !== details.sheetEntries) {
      next = putDocumentDetails(next, documentId, { ...details, sheetEntries });
    }
  }
  const project = next.project;
  const entry = project?.documents.find(
    (candidate) => candidate.documentId === documentId,
  );
  if (
    project !== null &&
    entry !== undefined &&
    entry.name !== documentState.document.name
  ) {
    next = setOpenProject(next, {
      ...project,
      documents: project.documents.map((candidate) =>
        candidate === entry
          ? { ...candidate, name: documentState.document.name }
          : candidate,
      ),
    });
  }
  return next;
}

// Entries follow `sheetOrder`; loaded sheets take their current name from the session.
// Entries of sheets that failed to load are kept as they were (they cannot change), and
// ones the order does not list come last. Returns `previous` when nothing differs, so
// subscribers are not notified for unrelated session changes.
export function syncSheetEntries(
  previous: readonly SheetEntry[],
  documentState: DocumentSessionState,
): readonly SheetEntry[] {
  const failedById = new Map(
    previous
      .filter((entry) => entry.state === "loadFailed")
      .map((entry) => [entry.sheetId, entry]),
  );
  const ordered = documentState.document.sheetOrder.flatMap(
    (sheetId): SheetEntry[] => {
      const sheet = documentState.sheets.get(sheetId);
      if (sheet !== undefined) {
        return [{ sheetId, name: sheet.name, state: "loaded" }];
      }
      const failed = failedById.get(sheetId);
      return failed === undefined ? [] : [failed];
    },
  );
  const listed = new Set(ordered.map((entry) => entry.sheetId));
  const unlisted = [...failedById.values()].filter(
    (entry) => !listed.has(entry.sheetId),
  );
  const next = [...ordered, ...unlisted];
  const unchanged =
    next.length === previous.length &&
    next.every(
      (entry, index) =>
        entry.sheetId === previous[index]?.sheetId &&
        entry.name === previous[index]?.name &&
        entry.state === previous[index]?.state,
    );
  return unchanged ? previous : next;
}

export function putDocumentDetails(
  state: ApplicationState,
  documentId: DocumentId,
  details: OpenDocumentDetails,
): ApplicationState {
  return {
    ...state,
    documentDetails: new Map(state.documentDetails).set(documentId, details),
  };
}

// Removes the session state together with the sibling details.
export function removeDocumentSession(
  state: ApplicationState,
  documentId: DocumentId,
): ApplicationState {
  if (!state.documents.has(documentId)) return state;
  const documents = new Map(state.documents);
  documents.delete(documentId);
  const documentDetails = new Map(state.documentDetails);
  documentDetails.delete(documentId);
  return { ...state, documents, documentDetails };
}

function reordered<Value>(
  map: ReadonlyMap<DocumentId, Value>,
  documentId: DocumentId,
  before: DocumentId | null,
): Map<DocumentId, Value> {
  const moved = map.get(documentId);
  const result = new Map<DocumentId, Value>();
  if (moved === undefined) return result;
  const place = () => result.set(documentId, moved);
  for (const [id, value] of map) {
    if (id === documentId) continue;
    if (id === before) place();
    result.set(id, value);
  }
  if (!result.has(documentId)) place();
  return result;
}

// Puts an open document in front of `before` (null = last) in the open-document order,
// which is the order of the Document Tabs (the insertion order of `documents`). The order
// is view state only: it is not saved and not part of the Project's childOrder. Returns
// the same state when the document is not open, `before` is not open, or nothing moves.
export function moveOpenDocument(
  state: ApplicationState,
  documentId: DocumentId,
  before: DocumentId | null,
): ApplicationState {
  if (!state.documents.has(documentId) || before === documentId) return state;
  if (before !== null && !state.documents.has(before)) return state;
  const order = [...state.documents.keys()];
  const index = order.indexOf(documentId);
  const next = before === null ? null : order[index + 1];
  if (before === null ? index === order.length - 1 : next === before) {
    return state;
  }
  return {
    ...state,
    documents: reordered(state.documents, documentId, before),
    documentDetails: reordered(state.documentDetails, documentId, before),
  };
}

// Callback for `createDocumentSession({ onStateChange })`. Uses `replace`, so register the
// session's initial state with `putDocumentSession` when the document is opened.
export function connectSessionToStore(
  store: ApplicationStore,
): (documentState: DocumentSessionState) => void {
  return (documentState) =>
    store.setState((state) => replaceDocumentSession(state, documentState));
}
