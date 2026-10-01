// Application / Domain State (docs/architecture.md §8.1): the open project, the open
// documents' immutable Domain values, history flags and save state. No UI concerns
// (selection, viewport, hover) belong here.

import type { Document } from "../../domain/document/document";
import type { Project } from "../../domain/project/project";
import type {
  DocumentId,
  ProjectId,
  SheetId,
} from "../../domain/shared/entity-id";
import type { Sheet } from "../../domain/sheet/sheet";
import { createStore, type Store } from "../../shared/store/store";
import type { CommandKind } from "../commands/command-kind";
import type { OperationWarning } from "../operation-warning";
import type { OperationError } from "../ports/operation-error";

export interface HistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: CommandKind | null;
  readonly redoLabel: CommandKind | null;
}

export interface SaveState {
  readonly dirtySheetIds: ReadonlySet<SheetId>;
  readonly documentDirty: boolean;
  readonly saving: boolean;
  // Set when the last save attempt failed; cleared by the next successful save.
  readonly lastError: OperationError | null;
}

export interface DocumentSessionState {
  readonly document: Document;
  readonly sheets: ReadonlyMap<SheetId, Sheet>;
  readonly history: HistoryState;
  readonly save: SaveState;
  // Non-fatal problems of the most recent operation (for example a content file that
  // could not be deleted after the sheet was saved). Reset when the next operation starts.
  readonly warnings: readonly OperationWarning[];
}

// Minimal placeholder: opening projects and documents (workspace service) comes later.
export interface OpenProjectDocumentEntry {
  readonly documentId: DocumentId;
  // null when the document failed to load and its name is unknown.
  readonly name: string | null;
  readonly loadFailed: boolean;
}

export interface OpenProjectState {
  readonly projectId: ProjectId;
  readonly project: Project;
  readonly documents: readonly OpenProjectDocumentEntry[];
}

export interface ApplicationState {
  readonly project: OpenProjectState | null;
  readonly documents: ReadonlyMap<DocumentId, DocumentSessionState>;
}

export type ApplicationStore = Store<ApplicationState>;

export function createInitialApplicationState(): ApplicationState {
  return { project: null, documents: new Map() };
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
// that was just closed cannot bring the document back.
export function replaceDocumentSession(
  state: ApplicationState,
  documentState: DocumentSessionState,
): ApplicationState {
  return state.documents.has(documentState.document.documentId)
    ? putDocumentSession(state, documentState)
    : state;
}

export function removeDocumentSession(
  state: ApplicationState,
  documentId: DocumentId,
): ApplicationState {
  if (!state.documents.has(documentId)) return state;
  const documents = new Map(state.documents);
  documents.delete(documentId);
  return { ...state, documents };
}

// Callback for `createDocumentSession({ onStateChange })`. Uses `replace`, so register the
// session's initial state with `putDocumentSession` when the document is opened.
export function connectSessionToStore(
  store: ApplicationStore,
): (documentState: DocumentSessionState) => void {
  return (documentState) =>
    store.setState((state) => replaceDocumentSession(state, documentState));
}
