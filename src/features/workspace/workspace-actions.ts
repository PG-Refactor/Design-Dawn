// The only module of the UI that calls the Workspace (and through it the document
// sessions) and updates UI state. Components call these actions; they never touch
// gateways, Tauri or the filesystem. Framework-free, so it is tested without a DOM.
//
// Failures are returned AND recorded as operation errors (shown in the notifications),
// never swallowed. Save retries are the exception: a failed retry already leaves the
// session / project save error in the application state, which is what is displayed.
// A cancelled folder dialog is not an error and changes nothing.

import {
  moveSheetCommand,
  renameDocumentCommand,
  renameSheetCommand,
} from "../../application/commands/naming-commands";
import type { AutoSavePolicy } from "../../application/ports/auto-save-policy";
import type {
  DocumentWindowTarget,
  ProjectWindowInfo,
} from "../../application/ports/document-window-gateway";
import {
  fromDomainResult,
  type OperationError,
  type OperationResult,
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import {
  FOLDER_SELECTION_STATUS,
  type FolderSelection,
  OPEN_IN_NEW_WINDOW_STATUS,
} from "../../application/ports/persistence-types";
import {
  type ApplicationStore,
  moveOpenDocument,
} from "../../application/state/application-state";
import {
  hasUnsavedDocumentChanges,
  hasUnsavedProjectChanges as hasUnsavedProjectChangesIn,
} from "../../application/state/unsaved-changes";
import {
  childOrderOf,
  deletionCounts,
  deletionSteps,
  findFolder,
  findProjectEntry,
} from "../../application/workspace/project-entries";
import type {
  CloseOptions,
  DestructiveConfirmation,
  Workspace,
} from "../../application/workspace/workspace";
import {
  type DisplayName,
  parseDisplayName,
} from "../../domain/shared/display-name";
import type {
  DocumentId,
  EntryId,
  FolderId,
  SheetId,
} from "../../domain/shared/entity-id";
import type { DraftRegistry } from "./draft-registry";
import { restoreMainTab, showDocumentTab } from "./ui-state/diff-tabs";
import {
  addOperationError,
  closeDialog,
  dismissOperationError,
  openDialog,
  setBusy,
  setLeftPanelMode,
  setNotificationsOpen,
  setSidebarCollapsed,
  setSourceEditorLayout,
  setTreeSelection,
  showNotice,
} from "./ui-state/shell-ui-state";
import {
  beginRenaming,
  endRenaming,
  entitySubject,
  type LeftPanelMode,
  type NewProjectRequest,
  type OperationLabel,
  type OperationSubject,
  type RenamingTarget,
  type SourceEditorLayout,
  setActiveDocument,
  setActiveSheet,
  setFolderCollapsed,
  type UiStateStore,
  type UnsavedCloseTarget,
} from "./ui-state/ui-state";
import { type MoveDirection, oneStepMove } from "./view-models/reorder";
import { documentTreeKey } from "./view-models/tree-items";
import { selectOnly, type TreeSelection } from "./view-models/tree-selection";

// A place a new Project can go in: a folder selection kept by Rust, and its path to show.
export interface ProjectLocation {
  readonly selectionId: string;
  readonly displayPath: string;
}

import { firstLoadedSheetId } from "./view-models/tabs-model";

// The answer to the "unsaved changes" question of a window close request.
export type UnsavedCloseChoice = "save" | "discard" | "cancel";

export interface WorkspaceActions {
  // With auto-save off and unsaved changes, the project / document close, and opening
  // another Project, ask first (`confirmUnsavedClose`) and do nothing yet.
  openProjectViaDialog(): Promise<OperationResult<void>>;
  // At start-up: opens the Project and Document a launch argument (`.dawn`) asked for.
  // Does nothing when there was none; runs only once per app, however often it is called.
  openLaunchRequest(): Promise<OperationResult<void>>;
  // Asks for a folder and opens its Project in a window of its own (or brings forward the
  // window that already has it, with a light notice). This window is not changed, so no
  // unsaved-changes question is asked. Cancelling the folder dialog does nothing.
  openProjectInNewWindowViaDialog(): Promise<OperationResult<void>>;
  // Rust asked this window to show a Document of its Project (a `.dawn` opened again from
  // outside): opens and activates it, or activates its tab with a light notice when it is
  // already open.
  openDocumentFromRequest(
    documentId: DocumentId,
  ): Promise<OperationResult<void>>;
  requestCreateProject(): void;
  // The place of a new Project: the default one (null when none is set) and one chosen
  // with the folder dialog (null when cancelled). Failures are notified.
  defaultProjectLocation(): Promise<OperationResult<ProjectLocation | null>>;
  chooseProjectLocation(): Promise<OperationResult<ProjectLocation | null>>;
  // Creates the Project from the New Project dialog. The dialog stays open when it fails.
  createProjectViaDialog(
    request: NewProjectRequest,
  ): Promise<OperationResult<void>>;
  closeProject(): Promise<OperationResult<void>>;
  // Whether closing the app window must ask first: auto-save is off and something of the
  // open Project (or a Markdown draft) is not saved.
  windowCloseNeedsConfirmation(): boolean;
  // Shows the question for a window close and resolves to the user's answer.
  askUnsavedWindowClose(): Promise<UnsavedCloseChoice>;
  // The answer to the open `confirmUnsavedClose` dialog. "save" runs the normal
  // save-then-close path (a failure keeps everything open, the error stays visible);
  // "discard" closes without saving and drops the drafts.
  answerUnsavedClose(
    choice: Exclude<UnsavedCloseChoice, "cancel">,
  ): Promise<OperationResult<void>>;

  // Opens the document if needed, makes it active and activates its first sheet when
  // none is active. A document that failed to load is left alone. A Document another
  // window holds is shown there (Rust brings that window forward), with a light notice.
  openDocument(documentId: DocumentId): Promise<OperationResult<void>>;
  // Moves an open Document to a new window (where it was dropped, when known) or to
  // another window of the Project, with its unsaved changes and history; nothing is
  // saved. Editor drafts are committed first. The neighbouring tab becomes active here.
  moveDocumentToWindow(
    documentId: DocumentId,
    target: DocumentWindowTarget,
  ): Promise<OperationResult<void>>;
  // A Document tab was dragged out of the window and let go at a screen point: the
  // Document goes to the window of the Project under it, or to a new window there.
  moveDocumentOutTo(
    documentId: DocumentId,
    screenX: number,
    screenY: number,
  ): Promise<OperationResult<void>>;
  // Another window handed a Document to this one: opens it as it was there and shows it.
  receiveDocument(transferId: string): Promise<OperationResult<void>>;
  // Another window tried to open a Document this window holds: shows its tab.
  showDocumentFromOtherWindow(documentId: DocumentId): void;
  // Another window changed the tree or a Document's name.
  refreshProjectTree(): Promise<OperationResult<void>>;
  // The windows of the Project, for "move to …".
  listProjectWindows(): Promise<OperationResult<readonly ProjectWindowInfo[]>>;
  // Saves first (the workspace decides); on success the neighbouring tab becomes active.
  closeDocument(documentId: DocumentId): Promise<OperationResult<void>>;
  selectSheet(
    documentId: DocumentId,
    sheetId: SheetId,
  ): Promise<OperationResult<void>>;

  // `parentFolderId` null (the default) = directly under the Project.
  requestCreateDocument(parentFolderId?: FolderId | null): void;
  createDocument(
    name: string,
    parentFolderId?: FolderId | null,
  ): Promise<OperationResult<void>>;
  requestCreateFolder(parentFolderId?: FolderId | null): void;
  createFolder(
    name: string,
    parentFolderId?: FolderId | null,
  ): Promise<OperationResult<void>>;
  // Opens the document first if needed, then asks for the name.
  requestCreateSheet(documentId: DocumentId): Promise<OperationResult<void>>;
  createSheet(
    documentId: DocumentId,
    name: string,
  ): Promise<OperationResult<void>>;

  requestDeleteDocument(documentId: DocumentId): void;
  requestDeleteSheet(documentId: DocumentId, sheetId: SheetId): void;
  // Only an empty folder is offered a confirmation; anything else does nothing (the menu
  // item is disabled, and the application refuses it again).
  requestDeleteFolder(folderId: FolderId): void;
  // Opens the target picker for a Document / a loaded Folder (open Documents move too).
  requestMoveEntry(entryId: EntryId): void;
  // The same picker for several entries chosen in the tree (those that failed to load are
  // left out; nothing opens when none is left).
  requestMoveEntries(entryIds: readonly EntryId[]): void;
  // Asks once, then deletes several entries chosen in the tree: Documents (closing them
  // when open) and empty Folders. Nothing is asked when a chosen Folder is not empty (the
  // menu item is disabled).
  requestDeleteEntries(entryIds: readonly EntryId[]): void;
  // Opens the Document in a window of its own: opened here first when it is not open, then
  // moved to a new window (as the Document tab's "Move to New Window").
  openDocumentInNewWindow(
    documentId: DocumentId,
  ): Promise<OperationResult<void>>;
  // Moves the entry into `targetParentFolderId` (null = Project root), last or in front of
  // `beforeEntryId`, and closes the picker. When a Document that moves has unsaved changes
  // it asks first (see `confirmMoveSave`) and moves nothing yet.
  moveEntryTo(
    entryId: EntryId,
    targetParentFolderId: FolderId | null,
    beforeEntryId?: EntryId | null,
  ): Promise<OperationResult<void>>;
  // A drop in the Project Tree: puts the entries, in the order given, into the target in
  // front of `beforeEntryId` (null = last). Within an entry's own parent that only reorders
  // (saved at once, not undoable, like any reorder); into another parent it moves, asking
  // once first when anything that moves has unsaved changes (see `confirmMoveSave`).
  placeEntries(
    entryIds: readonly EntryId[],
    targetParentFolderId: FolderId | null,
    beforeEntryId: EntryId | null,
  ): Promise<OperationResult<void>>;
  // The answer "save and move": commits the drafts and saves only the Documents that move,
  // then moves. Any failure leaves everything in place (the errors stay visible) and
  // closes the dialog.
  confirmMoveSave(): Promise<OperationResult<void>>;
  // Creates a folder from the move picker: immediate and not undoable, like any folder
  // creation, but the dialog stays open. Returns the new folder's id so the picker can
  // highlight it. The folder stays if the move is cancelled afterwards.
  createFolderForMove(
    parentFolderId: FolderId | null,
    name: string,
  ): Promise<OperationResult<FolderId>>;
  // Folders are expanded unless folded; presentation only, never saved.
  setFolderExpanded(folderId: FolderId, expanded: boolean): void;
  toggleFolder(folderId: FolderId): void;
  // Runs the deletion the dialog asked for, passing the user's confirmation.
  confirmDelete(): Promise<OperationResult<void>>;
  cancelDialog(): void;

  // Opens the inline name editor of a loaded document (opening the document first when it
  // is not open) / of a loaded sheet. Nothing happens for entries that failed to load.
  beginRenameDocument(documentId: DocumentId): Promise<OperationResult<void>>;
  beginRenameSheet(
    documentId: DocumentId,
    sheetId: SheetId,
  ): Promise<OperationResult<void>>;
  beginRenameFolder(folderId: FolderId): Promise<OperationResult<void>>;
  cancelRename(): void;
  // Ends the open rename with `name`. A name the domain refuses is returned as an error
  // and NOT recorded: the editor stays open and shows the message. Otherwise the editor
  // closes; an unchanged name does nothing, a changed one is ONE undoable command.
  commitRename(name: string): Promise<OperationResult<void>>;
  // One place up / down. Documents and folders: the order of their parent, saved at once,
  // not undoable. At the boundary (or for an entry that failed to load) nothing happens.
  moveDocumentBy(
    documentId: DocumentId,
    direction: MoveDirection,
  ): Promise<OperationResult<void>>;
  // Sheets (Sheet Tabs): puts the sheet directly in front of `before` (null = last) as
  // ONE undoable command, however far it travels. Staying where it is, an unknown or
  // failed sheet and a closed document do nothing at all (no history, no save).
  moveSheetTo(
    documentId: DocumentId,
    sheetId: SheetId,
    before: SheetId | null,
  ): Promise<OperationResult<void>>;

  // Document Tabs: puts the open document's tab in front of the tab of `before` (null =
  // last). The tab order is view state: not undoable, not saved, and independent of the
  // Project Tree order. Unknown or closed documents and a drop in place do nothing.
  moveDocumentTab(documentId: DocumentId, before: DocumentId | null): void;

  moveFolderBy(
    folderId: FolderId,
    direction: MoveDirection,
  ): Promise<OperationResult<void>>;

  retryDocumentSave(documentId: DocumentId): Promise<OperationResult<void>>;
  retryFolderSave(folderId: FolderId): Promise<OperationResult<void>>;
  retryProjectSave(): Promise<OperationResult<void>>;
  // Explicit "save everything": open drafts become commands first, then the project and
  // every document are written. The workspace save runs even when a draft failed to
  // commit. Returns the first error (a draft's first); failures are already visible
  // through the operation errors / save states, so nothing is recorded here.
  saveAll(): Promise<OperationResult<void>>;

  // Building blocks of the Git discard flow (`features/git/git-discard-flow.ts`), which
  // owns the order of the steps. Both are plain steps: neither asks a question nor sets the
  // busy state; the caller has done that.
  //
  // Closes the open Document WITHOUT saving: its pending save and Markdown draft are
  // dropped and its Undo history ends, so a later open reads the files from disk again. A
  // failure is returned and recorded; the Document then stays open.
  closeDocumentWithoutSaving(
    documentId: DocumentId,
  ): Promise<OperationResult<void>>;
  // Reads the current Project from disk again (`Workspace.reloadProject`; it must have
  // nothing unsaved, open Documents are saved and closed first). Resolves to whether the
  // Project is open again. When reading fails the error is recorded and the Project is
  // closed so that no stale tree stays.
  reopenProject(): Promise<OperationResult<boolean>>;

  dismissOperationError(id: number): void;
  setNotificationsOpen(open: boolean): void;
  setLeftPanelMode(mode: LeftPanelMode): void;
  setSidebarCollapsed(collapsed: boolean): void;
  // The Source | Preview split of the text block editors (share of the source, or the
  // preview hidden). Kept within the configured limits.
  setSourceEditorLayout(layout: SourceEditorLayout): void;
  // The rows chosen in the Project Tree.
  setTreeSelection(selection: TreeSelection): void;
  // Chooses the row of the Document the user is working on (a click or focus in its area),
  // unless it is already the only row chosen.
  revealDocumentInTree(documentId: DocumentId): void;
}

export interface WorkspaceActionsDependencies {
  readonly workspace: Workspace;
  readonly applicationStore: ApplicationStore;
  readonly uiStateStore: UiStateStore;
  readonly draftRegistry: DraftRegistry;
  readonly autoSavePolicy: AutoSavePolicy;
}

const USER_CONFIRMATION: DestructiveConfirmation = { confirmedByUser: true };
const DISCARD_CHANGES: CloseOptions = { discardChanges: true };

// The element after the removed one, else the one before it; null when none is left.
function neighbourOf<Id>(order: readonly Id[], removed: Id): Id | null {
  const index = order.indexOf(removed);
  if (index < 0) return null;
  return order[index + 1] ?? order[index - 1] ?? null;
}

export function createWorkspaceActions(
  dependencies: WorkspaceActionsDependencies,
): WorkspaceActions {
  const {
    workspace,
    applicationStore,
    uiStateStore,
    draftRegistry,
    autoSavePolicy,
  } = dependencies;
  // Not UI state: a callback cannot live in the store. Set only while the window-close
  // question is open.
  let pendingWindowDecision: ((choice: UnsavedCloseChoice) => void) | null =
    null;

  function settleWindowDecision(choice: UnsavedCloseChoice): void {
    const settle = pendingWindowDecision;
    pendingWindowDecision = null;
    settle?.(choice);
  }

  function record(
    operation: OperationLabel,
    subject: OperationSubject | null,
    error: OperationError,
  ): void {
    uiStateStore.setState((state) =>
      addOperationError(state, operation, subject, error),
    );
  }

  // Disables repeated clicks while a workspace operation is running.
  async function runBusy<T>(task: () => Promise<T>): Promise<T> {
    uiStateStore.setState((state) => setBusy(state, true));
    try {
      return await task();
    } finally {
      uiStateStore.setState((state) => setBusy(state, false));
    }
  }

  function documentNameOf(documentId: DocumentId): string | null {
    const entry = applicationStore
      .getState()
      .project?.documents.find(
        (candidate) => candidate.documentId === documentId,
      );
    return entry?.name ?? null;
  }

  function activateSheet(documentId: DocumentId, sheetId: SheetId): void {
    uiStateStore.setState((state) =>
      setActiveSheet(
        showDocumentTab(setActiveDocument(state, documentId)),
        documentId,
        sheetId,
      ),
    );
  }

  // Keeps the active sheet of a document valid: the remembered one when it still is a
  // loaded sheet, else `preferred`, else the first loaded sheet.
  function ensureActiveSheet(
    documentId: DocumentId,
    preferred: SheetId | null,
  ): void {
    const application = applicationStore.getState();
    const loaded = (
      application.documentDetails.get(documentId)?.sheetEntries ?? []
    ).filter((entry) => entry.state === "loaded");
    const current = uiStateStore
      .getState()
      .activeSheetIdByDocument.get(documentId);
    if (loaded.some((entry) => entry.sheetId === current)) return;
    const target =
      preferred !== null && loaded.some((entry) => entry.sheetId === preferred)
        ? preferred
        : firstLoadedSheetId(application, documentId);
    if (target !== null) {
      uiStateStore.setState((state) =>
        setActiveSheet(state, documentId, target),
      );
    }
  }

  // The user chose this Document, so it is shown in the main area (a diff tab stays open).
  function activateDocument(documentId: DocumentId): void {
    uiStateStore.setState((state) =>
      showDocumentTab(setActiveDocument(state, documentId)),
    );
    ensureActiveSheet(documentId, null);
  }

  // Resolves to whether the document is open afterwards. A document that failed to load
  // is not an error here: the UI never offers to open it.
  async function ensureOpen(
    documentId: DocumentId,
  ): Promise<OperationResult<boolean>> {
    const application = applicationStore.getState();
    if (application.documents.has(documentId)) return operationOk(true);
    const entry = application.project?.documents.find(
      (candidate) => candidate.documentId === documentId,
    );
    if (entry?.state !== "loaded") return operationOk(false);
    const opened = await workspace.openDocument(documentId);
    if (!opened.ok) {
      // Not a failure: the window that holds it was brought forward.
      if (opened.error.kind === "documentOpenInOtherWindow") {
        uiStateStore.setState((state) =>
          showNotice(state, "documentOpenInOtherWindow"),
        );
        return operationOk(false);
      }
      record("openDocument", entry.name, opened.error);
      return opened;
    }
    return operationOk(true);
  }

  // After a document was closed or deleted: when it was the active one, the neighbouring
  // tab takes over (tab order as it was before the removal).
  function activateNeighbourTab(
    removed: DocumentId,
    orderBefore: readonly DocumentId[],
    wasActive: boolean,
  ): void {
    if (!wasActive) return;
    if (applicationStore.getState().documents.has(removed)) return;
    const neighbour = neighbourOf(orderBefore, removed);
    if (neighbour !== null) activateDocument(neighbour);
  }

  async function finishRemoval(
    documentId: DocumentId,
    removal: () => Promise<OperationResult<void>>,
  ): Promise<OperationResult<void>> {
    const orderBefore = [...applicationStore.getState().documents.keys()];
    const wasActive = uiStateStore.getState().activeDocumentId === documentId;
    // The neighbour becomes the remembered Document; an active diff tab keeps the main area.
    const mainTab = uiStateStore.getState().activeMainTab;
    const result = await removal();
    activateNeighbourTab(documentId, orderBefore, wasActive);
    uiStateStore.setState((state) => restoreMainTab(state, mainTab));
    return result;
  }

  function startRenaming(target: RenamingTarget): void {
    uiStateStore.setState((state) => beginRenaming(state, target));
  }

  // The name the document / sheet has right now (null when it is not loaded).
  function currentNameOf(target: RenamingTarget): string | null {
    if (target.kind === "folder") {
      const project = applicationStore.getState().project;
      return project === null
        ? null
        : (findFolder(project, target.folderId)?.name ?? null);
    }
    const session = applicationStore
      .getState()
      .documents.get(target.documentId);
    if (session === undefined) return null;
    return target.kind === "document"
      ? session.document.name
      : (session.sheets.get(target.sheetId)?.name ?? null);
  }

  async function renameThroughSession(
    target: Exclude<RenamingTarget, { readonly kind: "folder" }>,
    name: DisplayName,
    subject: string | null,
  ): Promise<OperationResult<void>> {
    const operation =
      target.kind === "document" ? "renameDocument" : "renameSheet";
    const session = workspace.getDocumentSession(target.documentId);
    const result =
      session === null
        ? operationErr(
            "notWritable",
            `document is not open: ${target.documentId}`,
          )
        : await session.execute(
            target.kind === "document"
              ? renameDocumentCommand(name)
              : renameSheetCommand(target.sheetId, name),
          );
    if (!result.ok) record(operation, subject, result.error);
    return result;
  }

  // Makes sure a folder that just received something is open, so the user sees it.
  function expandFolder(folderId: FolderId | null): void {
    if (folderId === null) return;
    uiStateStore.setState((state) =>
      setFolderCollapsed(state, folderId, false),
    );
  }

  function entryNameOf(entryId: EntryId): string | null {
    const project = applicationStore.getState().project;
    const found = project === null ? null : findProjectEntry(project, entryId);
    return found?.entry.name ?? null;
  }

  // Anything a move would carry along that is not on disk yet: a command still waiting for
  // its save, a failed save, a save in progress, or a Markdown draft not yet committed.
  function hasUnsavedChangesIn(documentIds: readonly DocumentId[]): boolean {
    if (draftRegistry.hasPendingFor(documentIds)) return true;
    return hasUnsavedDocumentChanges(applicationStore.getState(), documentIds);
  }

  // The Project itself or any Folder is unsaved, or anything in an open document
  // (including Markdown drafts, which only the draft registry knows).
  function hasUnsavedProjectChanges(): boolean {
    const state = applicationStore.getState();
    return (
      hasUnsavedProjectChangesIn(state) ||
      draftRegistry.hasPendingFor([...state.documents.keys()])
    );
  }

  // Auto-save on keeps today's behaviour (save, then close): only with it off can closing
  // lose something, so only then is the user asked.
  function opensUnsavedCloseDialog(
    hasUnsaved: boolean,
    target: UnsavedCloseTarget,
  ): boolean {
    if (autoSavePolicy.isEnabled() || !hasUnsaved) return false;
    uiStateStore.setState((state) =>
      openDialog(state, { kind: "confirmUnsavedClose", target }),
    );
    return true;
  }

  async function closeProjectNow(
    discardChanges: boolean,
  ): Promise<OperationResult<void>> {
    if (discardChanges) {
      draftRegistry.discardAll();
    } else {
      const drafts = await draftRegistry.commitAll();
      if (!drafts.ok) return drafts;
    }
    const result = await workspace.closeProject(
      discardChanges ? DISCARD_CHANGES : undefined,
    );
    if (!result.ok) record("closeProject", null, result.error);
    return result;
  }

  async function closeDocumentNow(
    documentId: DocumentId,
    discardChanges: boolean,
  ): Promise<OperationResult<void>> {
    const name = documentNameOf(documentId);
    const result = await finishRemoval(documentId, async () => {
      if (discardChanges) {
        // Before the close: the editor unmounts right after it and must find nothing to
        // commit.
        draftRegistry.discardFor([documentId]);
        return workspace.closeDocument(documentId, DISCARD_CHANGES);
      }
      const drafts = await draftRegistry.commitFor([documentId]);
      if (!drafts.ok) return drafts;
      return workspace.closeDocument(documentId);
    });
    if (!result.ok) record("closeDocument", entitySubject(name), result.error);
    return result;
  }

  // Reorders among the siblings of the entry's own parent.
  async function reorderEntry(
    entryId: EntryId,
    beforeEntryId: EntryId | null,
  ): Promise<OperationResult<void>> {
    const project = applicationStore.getState().project;
    const found = project === null ? null : findProjectEntry(project, entryId);
    if (found === null) return operationOk(undefined);
    if (found.kind === "folder") {
      const result = await workspace.moveFolder(
        found.entry.folderId,
        beforeEntryId,
      );
      if (!result.ok) record("moveFolder", found.entry.name, result.error);
      return result;
    }
    const result = await workspace.moveDocument(
      found.entry.documentId,
      beforeEntryId,
    );
    if (!result.ok) record("moveDocument", found.entry.name, result.error);
    return result;
  }

  // Puts each entry, in the order given, into the target in front of `beforeEntryId`: a
  // reorder within its own parent, a move into another one. Stops at the first failure
  // (what moved before it stays moved, like any move).
  async function placeAll(
    entryIds: readonly EntryId[],
    targetParentFolderId: FolderId | null,
    beforeEntryId: EntryId | null,
  ): Promise<OperationResult<void>> {
    for (const entryId of entryIds) {
      const project = applicationStore.getState().project;
      const found =
        project === null ? null : findProjectEntry(project, entryId);
      if (found === null || found.entry.state !== "loaded") continue;
      const result =
        found.entry.parentFolderId === targetParentFolderId
          ? await reorderEntry(entryId, beforeEntryId)
          : await performMove(
              entryId,
              found.entry.name,
              targetParentFolderId,
              beforeEntryId,
            );
      if (!result.ok) return result;
    }
    return operationOk(undefined);
  }

  // The open Documents that a move of these entries carries along.
  function documentsMovedWith(entryIds: readonly EntryId[]): DocumentId[] {
    return [
      ...new Set(entryIds.flatMap((id) => workspace.openDocumentsUnder(id))),
    ];
  }

  // Asks first (and moves nothing yet) when an open Document that moves has unsaved
  // changes; otherwise places the entries and closes the move picker if it is open.
  function requestPlacement(
    entryIds: readonly EntryId[],
    targetParentFolderId: FolderId | null,
    beforeEntryId: EntryId | null,
  ): Promise<OperationResult<void>> {
    const [first] = entryIds;
    if (uiStateStore.getState().busy || first === undefined) {
      return Promise.resolve(operationOk(undefined));
    }
    if (hasUnsavedChangesIn(documentsMovedWith(entryIds))) {
      uiStateStore.setState((state) =>
        openDialog(state, {
          kind: "confirmMoveSave",
          entryIds,
          name: entryNameOf(first),
          targetParentFolderId,
          beforeEntryId,
        }),
      );
      return Promise.resolve(operationOk(undefined));
    }
    return runBusy(async () => {
      const result = await placeAll(
        entryIds,
        targetParentFolderId,
        beforeEntryId,
      );
      uiStateStore.setState(closeDialog);
      return result;
    });
  }

  async function performMove(
    entryId: EntryId,
    name: string | null,
    targetParentFolderId: FolderId | null,
    beforeEntryId: EntryId | null,
  ): Promise<OperationResult<void>> {
    const result = await workspace.moveEntry(entryId, targetParentFolderId);
    if (!result.ok) {
      record("moveEntry", entitySubject(name), result.error);
      return result;
    }
    expandFolder(targetParentFolderId);
    // A move appends to the new parent; a place in front of a sibling is a second step.
    return beforeEntryId === null
      ? result
      : reorderEntry(entryId, beforeEntryId);
  }

  function folderNameOf(folderId: FolderId): string | null {
    const project = applicationStore.getState().project;
    return project === null
      ? null
      : (findFolder(project, folderId)?.name ?? null);
  }

  // A folder and everything inside it (the confirmation named what goes with it).
  function deleteFolderConfirmed(
    folderId: FolderId,
  ): Promise<OperationResult<void>> {
    return deleteEntriesConfirmed([folderId]);
  }

  // One Folder whose contents are already deleted.
  async function deleteEmptyFolder(
    folderId: FolderId,
    name: string | null,
  ): Promise<OperationResult<void>> {
    const result = await workspace.deleteFolder(folderId, USER_CONFIRMATION);
    if (!result.ok) {
      record("deleteFolder", entitySubject(name), result.error);
      return result;
    }
    // The folded state of a folder that no longer exists is not worth keeping.
    uiStateStore.setState((state) =>
      setFolderCollapsed(state, folderId, false),
    );
    return result;
  }

  async function selectAndOpenProject(
    discardChanges: boolean,
  ): Promise<OperationResult<void>> {
    {
      const selected = await workspace.selectProjectFolder();
      if (!selected.ok) {
        record("selectFolder", null, selected.error);
        return selected;
      }
      if (selected.value.status === FOLDER_SELECTION_STATUS.cancelled) {
        return operationOk(undefined);
      }
      const { selectionId } = selected.value;
      // Only now that a folder was chosen is anything given up or committed: cancelling
      // the folder dialog must leave the open Project exactly as it was.
      if (discardChanges) {
        draftRegistry.discardAll();
      } else {
        const drafts = await draftRegistry.commitAll();
        if (!drafts.ok) return drafts;
      }
      const options = discardChanges ? DISCARD_CHANGES : undefined;
      const result = await workspace.openProject(selectionId, options);
      uiStateStore.setState(closeDialog);
      if (!result.ok) record("openProject", null, result.error);
      return result;
    }
  }

  async function createProjectNow(
    request: NewProjectRequest,
    discardChanges: boolean,
  ): Promise<OperationResult<void>> {
    if (discardChanges) {
      draftRegistry.discardAll();
    } else {
      const drafts = await draftRegistry.commitAll();
      if (!drafts.ok) return drafts;
    }
    if (request.makeDefaultLocation) {
      // Only a convenience: the Project is created even when it cannot be remembered.
      const remembered = await workspace.setDefaultProjectLocation(
        request.locationSelectionId,
      );
      if (!remembered.ok) {
        record("setDefaultProjectLocation", null, remembered.error);
      }
    }
    const result = await workspace.createProject(
      request.locationSelectionId,
      request.name,
      discardChanges ? DISCARD_CHANGES : undefined,
      request.folderName,
    );
    if (!result.ok) record("createProject", null, result.error);
    return result;
  }

  function locationOf(
    selection: OperationResult<FolderSelection>,
  ): OperationResult<ProjectLocation | null> {
    if (!selection.ok) {
      record("selectFolder", null, selection.error);
      return selection;
    }
    return operationOk(
      selection.value.status === FOLDER_SELECTION_STATUS.cancelled
        ? null
        : {
            selectionId: selection.value.selectionId,
            displayPath: selection.value.displayPath,
          },
    );
  }

  async function reopenProjectNow(): Promise<OperationResult<boolean>> {
    const reloaded = await workspace.reloadProject();
    if (reloaded.ok) return operationOk(true);
    // Not reloaded: the Documents were closed and the tree may be out of date, so the
    // Project is closed instead of staying half alive. Nothing is unsaved by now.
    const closed = await closeProjectNow(false);
    // After the close, which resets the UI state (and with it the notifications).
    record("openProject", null, reloaded.error);
    return closed.ok ? operationOk(false) : closed;
  }

  function openProjectWithDialog(): Promise<OperationResult<void>> {
    return runBusy(() => selectAndOpenProject(false));
  }

  // Deletes the entries and everything inside the Folders among them, each Folder after
  // its contents (`deletionSteps`). Stops at the first failure: what was deleted before it
  // stays deleted, the rest stays, and the error is shown.
  async function deleteEntriesConfirmed(
    entryIds: readonly EntryId[],
  ): Promise<OperationResult<void>> {
    const project = applicationStore.getState().project;
    if (project === null) return operationOk(undefined);
    for (const step of deletionSteps(project, entryIds)) {
      const deleted =
        step.kind === "document"
          ? await deleteDocumentConfirmed(step.documentId, step.name)
          : await deleteEmptyFolder(step.folderId, step.name);
      if (!deleted.ok) return deleted;
    }
    return operationOk(undefined);
  }

  async function deleteDocumentConfirmed(
    documentId: DocumentId,
    name: string | null,
  ): Promise<OperationResult<void>> {
    const result = await finishRemoval(documentId, () =>
      workspace.deleteDocument(documentId, USER_CONFIRMATION),
    );
    if (!result.ok) record("deleteDocument", entitySubject(name), result.error);
    return result;
  }

  async function deleteSheetConfirmed(
    documentId: DocumentId,
    sheetId: SheetId,
    name: string | null,
  ): Promise<OperationResult<void>> {
    const loadedOrder = (
      applicationStore.getState().documentDetails.get(documentId)
        ?.sheetEntries ?? []
    )
      .filter((entry) => entry.state === "loaded")
      .map((entry) => entry.sheetId);
    const wasActive =
      uiStateStore.getState().activeSheetIdByDocument.get(documentId) ===
      sheetId;
    const result = await workspace.deleteSheet(
      documentId,
      sheetId,
      USER_CONFIRMATION,
    );
    if (!result.ok) {
      record("deleteSheet", entitySubject(name), result.error);
      return result;
    }
    if (wasActive)
      ensureActiveSheet(documentId, neighbourOf(loadedOrder, sheetId));
    return result;
  }

  let launchRequest: Promise<OperationResult<void>> | null = null;

  async function openLaunchRequestOnce(): Promise<OperationResult<void>> {
    const taken = await workspace.openLaunchRequest();
    if (!taken.ok) {
      record("openLaunchRequest", null, taken.error);
      return taken;
    }
    if (taken.value === null) return operationOk(undefined);
    const opened = await ensureOpen(taken.value);
    if (!opened.ok) return opened;
    if (opened.value) activateDocument(taken.value);
    return operationOk(undefined);
  }

  async function openProjectInNewWindowNow(): Promise<OperationResult<void>> {
    const selected = await workspace.selectProjectFolder();
    if (!selected.ok) {
      record("selectFolder", null, selected.error);
      return selected;
    }
    if (selected.value.status === FOLDER_SELECTION_STATUS.cancelled) {
      return operationOk(undefined);
    }
    const result = await workspace.openProjectInNewWindow(
      selected.value.selectionId,
    );
    if (!result.ok) {
      record("openProject", null, result.error);
      return result;
    }
    if (result.value.status === OPEN_IN_NEW_WINDOW_STATUS.focusedExisting) {
      const kind = result.value.inThisWindow
        ? "projectOpenInThisWindow"
        : "projectOpenInOtherWindow";
      uiStateStore.setState((state) => showNotice(state, kind));
    }
    return operationOk(undefined);
  }

  async function openDocumentFromRequestNow(
    documentId: DocumentId,
  ): Promise<OperationResult<void>> {
    if (applicationStore.getState().documents.has(documentId)) {
      activateDocument(documentId);
      uiStateStore.setState((state) =>
        showNotice(state, "documentAlreadyOpen"),
      );
      return operationOk(undefined);
    }
    const opened = await ensureOpen(documentId);
    if (!opened.ok) return opened;
    if (opened.value) activateDocument(documentId);
    return operationOk(undefined);
  }

  async function moveDocumentToWindowNow(
    documentId: DocumentId,
    target: DocumentWindowTarget,
  ): Promise<OperationResult<void>> {
    const name = documentNameOf(documentId);
    const result = await finishRemoval(documentId, async () => {
      // A draft is part of the Document: committed (an undoable edit) so it moves too.
      const drafts = await draftRegistry.commitFor([documentId]);
      if (!drafts.ok) return drafts;
      return workspace.moveDocumentToWindow(documentId, target);
    });
    if (!result.ok) {
      record("moveDocumentToWindow", entitySubject(name), result.error);
    }
    return result;
  }

  const actions: WorkspaceActions = {
    openProjectInNewWindowViaDialog: () => {
      if (uiStateStore.getState().busy) {
        return Promise.resolve(operationOk(undefined));
      }
      return runBusy(openProjectInNewWindowNow);
    },
    openDocumentFromRequest: openDocumentFromRequestNow,
    // React StrictMode runs effects twice; sharing the first call keeps it to one take.
    openLaunchRequest: () => {
      launchRequest ??= openLaunchRequestOnce();
      return launchRequest;
    },
    openProjectViaDialog: () => {
      if (uiStateStore.getState().busy)
        return Promise.resolve(operationOk(undefined));
      if (
        opensUnsavedCloseDialog(hasUnsavedProjectChanges(), {
          kind: "openProject",
        })
      ) {
        return Promise.resolve(operationOk(undefined));
      }
      return openProjectWithDialog();
    },
    requestCreateProject() {
      uiStateStore.setState((state) =>
        openDialog(state, { kind: "createProject" }),
      );
    },
    defaultProjectLocation: async () =>
      locationOf(await workspace.defaultProjectLocation()),
    chooseProjectLocation: async () =>
      locationOf(await workspace.selectProjectFolder()),
    createProjectViaDialog: (request) => {
      if (uiStateStore.getState().busy)
        return Promise.resolve(operationOk(undefined));
      if (
        opensUnsavedCloseDialog(hasUnsavedProjectChanges(), {
          kind: "createProject",
          request,
        })
      ) {
        return Promise.resolve(operationOk(undefined));
      }
      return runBusy(async () => {
        const result = await createProjectNow(request, false);
        if (result.ok) uiStateStore.setState(closeDialog);
        return result;
      });
    },
    closeProject() {
      if (
        opensUnsavedCloseDialog(hasUnsavedProjectChanges(), { kind: "project" })
      ) {
        return Promise.resolve(operationOk(undefined));
      }
      return runBusy(() => closeProjectNow(false));
    },
    windowCloseNeedsConfirmation: () =>
      !autoSavePolicy.isEnabled() && hasUnsavedProjectChanges(),
    askUnsavedWindowClose() {
      // A question that is still open can only be replaced by this one: answer it as
      // cancelled so nothing waits forever.
      settleWindowDecision("cancel");
      return new Promise<UnsavedCloseChoice>((resolve) => {
        pendingWindowDecision = resolve;
        uiStateStore.setState((state) =>
          openDialog(state, {
            kind: "confirmUnsavedClose",
            target: { kind: "window" },
          }),
        );
      });
    },
    answerUnsavedClose(choice) {
      const { dialog, busy } = uiStateStore.getState();
      if (busy || dialog.kind !== "confirmUnsavedClose") {
        return Promise.resolve(operationOk(undefined));
      }
      const { target } = dialog;
      if (target.kind === "window") {
        uiStateStore.setState(closeDialog);
        settleWindowDecision(choice);
        return Promise.resolve(operationOk(undefined));
      }
      const discardChanges = choice === "discard";
      // The dialog stays open (buttons disabled) while the work runs, like the delete
      // confirmations, and closes afterwards.
      return runBusy(async () => {
        const result = await (target.kind === "document"
          ? closeDocumentNow(target.documentId, discardChanges)
          : target.kind === "project"
            ? closeProjectNow(discardChanges)
            : target.kind === "createProject"
              ? createProjectNow(target.request, discardChanges)
              : selectAndOpenProject(discardChanges));
        uiStateStore.setState(closeDialog);
        return result;
      });
    },

    async openDocument(documentId) {
      const opened = await ensureOpen(documentId);
      if (!opened.ok) return opened;
      if (opened.value) activateDocument(documentId);
      return operationOk(undefined);
    },
    moveDocumentToWindow: moveDocumentToWindowNow,
    async moveDocumentOutTo(documentId, screenX, screenY) {
      const target = await workspace.dropTargetAt(screenX, screenY);
      if (!target.ok) {
        record(
          "moveDocumentToWindow",
          entitySubject(documentNameOf(documentId)),
          target.error,
        );
        return target;
      }
      return moveDocumentToWindowNow(documentId, target.value);
    },
    async receiveDocument(transferId) {
      const received = await workspace.receiveDocument(transferId);
      if (!received.ok) {
        record("receiveDocument", null, received.error);
        return received;
      }
      activateDocument(received.value);
      return operationOk(undefined);
    },
    showDocumentFromOtherWindow(documentId) {
      if (applicationStore.getState().documents.has(documentId)) {
        activateDocument(documentId);
      }
    },
    async refreshProjectTree() {
      const refreshed = await workspace.refreshProjectTree();
      if (!refreshed.ok) record("openProject", null, refreshed.error);
      return refreshed;
    },
    listProjectWindows: () => workspace.listProjectWindows(),
    closeDocument(documentId) {
      const name = documentNameOf(documentId);
      if (
        opensUnsavedCloseDialog(hasUnsavedChangesIn([documentId]), {
          kind: "document",
          documentId,
          name,
        })
      ) {
        return Promise.resolve(operationOk(undefined));
      }
      return closeDocumentNow(documentId, false);
    },
    async selectSheet(documentId, sheetId) {
      const opened = await ensureOpen(documentId);
      if (!opened.ok) return opened;
      if (!opened.value) return operationOk(undefined);
      const entry = applicationStore
        .getState()
        .documentDetails.get(documentId)
        ?.sheetEntries.find((candidate) => candidate.sheetId === sheetId);
      if (entry?.state !== "loaded") return operationOk(undefined);
      activateSheet(documentId, sheetId);
      return operationOk(undefined);
    },

    requestCreateDocument(parentFolderId = null) {
      uiStateStore.setState((state) =>
        openDialog(state, { kind: "createDocument", parentFolderId }),
      );
    },
    createDocument: (name, parentFolderId = null) =>
      runBusy(async () => {
        const created = await workspace.createDocument(name, parentFolderId);
        uiStateStore.setState(closeDialog);
        if (!created.ok) {
          record("createDocument", null, created.error);
          return created;
        }
        expandFolder(parentFolderId);
        const opened = await ensureOpen(created.value);
        if (!opened.ok) return opened;
        if (opened.value) activateDocument(created.value);
        return operationOk(undefined);
      }),
    requestCreateFolder(parentFolderId = null) {
      uiStateStore.setState((state) =>
        openDialog(state, { kind: "createFolder", parentFolderId }),
      );
    },
    createFolder: (name, parentFolderId = null) =>
      runBusy(async () => {
        const created = await workspace.createFolder(parentFolderId, name);
        uiStateStore.setState(closeDialog);
        if (!created.ok) {
          record("createFolder", null, created.error);
          return created;
        }
        expandFolder(parentFolderId);
        return operationOk(undefined);
      }),
    async requestCreateSheet(documentId) {
      const opened = await ensureOpen(documentId);
      if (!opened.ok) return opened;
      if (opened.value) {
        uiStateStore.setState((state) =>
          openDialog(state, { kind: "createSheet", documentId }),
        );
      }
      return operationOk(undefined);
    },
    createSheet: (documentId, name) =>
      runBusy(async () => {
        const created = await workspace.createSheet(documentId, name);
        uiStateStore.setState(closeDialog);
        if (!created.ok) {
          record("createSheet", documentNameOf(documentId), created.error);
          return created;
        }
        activateSheet(documentId, created.value);
        return operationOk(undefined);
      }),

    requestDeleteDocument(documentId) {
      const project = applicationStore.getState().project;
      const known = project?.documents.some(
        (entry) => entry.documentId === documentId,
      );
      if (known !== true) return;
      uiStateStore.setState((state) =>
        openDialog(state, {
          kind: "confirmDeleteDocument",
          documentId,
          name: documentNameOf(documentId),
        }),
      );
    },
    requestDeleteSheet(documentId, sheetId) {
      const entry = applicationStore
        .getState()
        .documentDetails.get(documentId)
        ?.sheetEntries.find((candidate) => candidate.sheetId === sheetId);
      if (entry === undefined) return;
      uiStateStore.setState((state) =>
        openDialog(state, {
          kind: "confirmDeleteSheet",
          documentId,
          sheetId,
          name: entry.name,
        }),
      );
    },
    requestDeleteFolder(folderId) {
      const project = applicationStore.getState().project;
      if (project === null || findFolder(project, folderId) === undefined) {
        return;
      }
      // What goes with it, besides the folder itself.
      const counts = deletionCounts(deletionSteps(project, [folderId]));
      uiStateStore.setState((state) =>
        openDialog(state, {
          kind: "confirmDeleteFolder",
          folderId,
          name: folderNameOf(folderId),
          documentsInside: counts.documents,
          foldersInside: counts.folders - 1,
        }),
      );
    },
    requestMoveEntry(entryId) {
      actions.requestMoveEntries([entryId]);
    },
    requestMoveEntries(entryIds) {
      const project = applicationStore.getState().project;
      if (project === null) return;
      const movable = entryIds.filter(
        (entryId) =>
          findProjectEntry(project, entryId)?.entry.state === "loaded",
      );
      const [first] = movable;
      if (first === undefined) return;
      uiStateStore.setState((state) =>
        openDialog(state, {
          kind: "moveEntry",
          entryIds: movable,
          name: entryNameOf(first),
        }),
      );
    },
    requestDeleteEntries(entryIds) {
      const project = applicationStore.getState().project;
      if (project === null) return;
      const steps = deletionSteps(project, entryIds);
      if (steps.length === 0) return;
      uiStateStore.setState((state) =>
        openDialog(state, {
          kind: "confirmDeleteEntries",
          entryIds,
          ...deletionCounts(steps),
        }),
      );
    },
    async openDocumentInNewWindow(documentId) {
      if (uiStateStore.getState().busy) return operationOk(undefined);
      const opened = await ensureOpen(documentId);
      // Not opened here (it failed to load, or another window holds it and was shown).
      if (!opened.ok || !opened.value)
        return opened.ok ? operationOk(undefined) : opened;
      return moveDocumentToWindowNow(documentId, {
        kind: "newWindow",
        screenX: null,
        screenY: null,
      });
    },
    moveEntryTo: (entryId, targetParentFolderId, beforeEntryId = null) =>
      requestPlacement([entryId], targetParentFolderId, beforeEntryId),
    confirmMoveSave() {
      const { dialog, busy } = uiStateStore.getState();
      if (busy || dialog.kind !== "confirmMoveSave") {
        return Promise.resolve(operationOk(undefined));
      }
      const { entryIds, targetParentFolderId, beforeEntryId } = dialog;
      return runBusy(async () => {
        // Only what moves is saved; other documents keep their own (auto-)save state.
        const affected = documentsMovedWith(entryIds);
        const drafts = await draftRegistry.commitFor(affected);
        const flushed = drafts.ok
          ? await workspace.flushDocuments(affected)
          : drafts;
        if (!flushed.ok) {
          uiStateStore.setState(closeDialog);
          return flushed;
        }
        const result = await placeAll(
          entryIds,
          targetParentFolderId,
          beforeEntryId,
        );
        uiStateStore.setState(closeDialog);
        return result;
      });
    },
    createFolderForMove: (parentFolderId, name) =>
      runBusy(async () => {
        const created = await workspace.createFolder(parentFolderId, name);
        if (!created.ok) {
          record("createFolder", null, created.error);
          return created;
        }
        expandFolder(parentFolderId);
        return created;
      }),
    setFolderExpanded(folderId, expanded) {
      uiStateStore.setState((state) =>
        setFolderCollapsed(state, folderId, !expanded),
      );
    },
    toggleFolder(folderId) {
      uiStateStore.setState((state) =>
        setFolderCollapsed(
          state,
          folderId,
          !state.collapsedFolderIds.has(folderId),
        ),
      );
    },
    confirmDelete() {
      const { dialog, busy } = uiStateStore.getState();
      if (busy) return Promise.resolve(operationOk(undefined));
      if (dialog.kind === "confirmDeleteEntries") {
        const { entryIds } = dialog;
        return runBusy(async () => {
          const result = await deleteEntriesConfirmed(entryIds);
          uiStateStore.setState(closeDialog);
          return result;
        });
      }
      if (
        dialog.kind !== "confirmDeleteDocument" &&
        dialog.kind !== "confirmDeleteSheet" &&
        dialog.kind !== "confirmDeleteFolder"
      ) {
        return Promise.resolve(operationOk(undefined));
      }
      // The dialog stays open while the deletion runs, then closes: focus is restored
      // after the entity is gone from the tree.
      return runBusy(async () => {
        const result =
          dialog.kind === "confirmDeleteFolder"
            ? await deleteFolderConfirmed(dialog.folderId)
            : dialog.kind === "confirmDeleteDocument"
              ? await deleteDocumentConfirmed(dialog.documentId, dialog.name)
              : await deleteSheetConfirmed(
                  dialog.documentId,
                  dialog.sheetId,
                  dialog.name,
                );
        uiStateStore.setState(closeDialog);
        return result;
      });
    },
    cancelDialog() {
      const { dialog } = uiStateStore.getState();
      if (
        dialog.kind === "confirmUnsavedClose" &&
        dialog.target.kind === "window"
      ) {
        settleWindowDecision("cancel");
      }
      uiStateStore.setState(closeDialog);
    },

    async beginRenameDocument(documentId) {
      const entry = applicationStore
        .getState()
        .project?.documents.find(
          (candidate) => candidate.documentId === documentId,
        );
      if (entry?.state !== "loaded") return operationOk(undefined);
      // A document that is not open is opened (and becomes active) first; an open one
      // keeps whatever is active, because renaming is not a navigation.
      if (!applicationStore.getState().documents.has(documentId)) {
        const opened = await ensureOpen(documentId);
        if (!opened.ok) return opened;
        if (!opened.value) return operationOk(undefined);
        activateDocument(documentId);
      }
      startRenaming({ kind: "document", documentId });
      return operationOk(undefined);
    },
    beginRenameSheet(documentId, sheetId) {
      const entry = applicationStore
        .getState()
        .documentDetails.get(documentId)
        ?.sheetEntries.find((candidate) => candidate.sheetId === sheetId);
      if (entry?.state === "loaded") {
        startRenaming({ kind: "sheet", documentId, sheetId });
      }
      return Promise.resolve(operationOk(undefined));
    },
    beginRenameFolder(folderId) {
      const project = applicationStore.getState().project;
      const entry =
        project === null ? undefined : findFolder(project, folderId);
      if (entry?.state === "loaded") {
        startRenaming({ kind: "folder", folderId });
      }
      return Promise.resolve(operationOk(undefined));
    },
    cancelRename() {
      uiStateStore.setState(endRenaming);
    },
    async commitRename(name) {
      const target = uiStateStore.getState().renaming;
      if (target === null) return operationOk(undefined);
      const parsed = parseDisplayName(name);
      if (!parsed.ok) return fromDomainResult(parsed);
      const current = currentNameOf(target);
      // The editor closes before the command runs, so it cannot be submitted twice.
      uiStateStore.setState(endRenaming);
      if (current === name) return operationOk(undefined);
      if (target.kind === "folder") {
        const renamed = await workspace.renameFolder(
          target.folderId,
          parsed.value,
        );
        if (!renamed.ok) record("renameFolder", current, renamed.error);
        return renamed;
      }
      return renameThroughSession(target, parsed.value, current);
    },

    placeEntries: (entryIds, targetParentFolderId, beforeEntryId) =>
      requestPlacement(entryIds, targetParentFolderId, beforeEntryId),
    async moveDocumentBy(documentId, direction) {
      const project = applicationStore.getState().project;
      const entry = project?.documents.find(
        (candidate) => candidate.documentId === documentId,
      );
      if (project === null || entry?.state !== "loaded") {
        return operationOk(undefined);
      }
      // The order of the document's own parent, which also lists Folders.
      const step = oneStepMove(
        childOrderOf(project, entry.parentFolderId) ?? [],
        documentId,
        direction,
      );
      if (step === null) return operationOk(undefined);
      const result = await workspace.moveDocument(documentId, step.before);
      if (!result.ok) record("moveDocument", entry.name, result.error);
      return result;
    },
    async moveFolderBy(folderId, direction) {
      const project = applicationStore.getState().project;
      const entry =
        project === null ? undefined : findFolder(project, folderId);
      if (project === null || entry?.state !== "loaded") {
        return operationOk(undefined);
      }
      const step = oneStepMove(
        childOrderOf(project, entry.parentFolderId) ?? [],
        folderId,
        direction,
      );
      if (step === null) return operationOk(undefined);
      const result = await workspace.moveFolder(folderId, step.before);
      if (!result.ok) record("moveFolder", entry.name, result.error);
      return result;
    },
    moveDocumentTab(documentId, before) {
      applicationStore.setState((state) =>
        moveOpenDocument(state, documentId, before),
      );
    },
    async moveSheetTo(documentId, sheetId, before) {
      const session = applicationStore.getState().documents.get(documentId);
      const entry = applicationStore
        .getState()
        .documentDetails.get(documentId)
        ?.sheetEntries.find((candidate) => candidate.sheetId === sheetId);
      if (session === undefined || entry?.state !== "loaded") {
        return operationOk(undefined);
      }
      const order = session.document.sheetOrder;
      const index = order.indexOf(sheetId);
      const stays =
        before === sheetId ||
        (before !== null && !order.includes(before)) ||
        (before === null
          ? index === order.length - 1
          : order[index + 1] === before);
      if (stays) return operationOk(undefined);
      const result =
        (await workspace
          .getDocumentSession(documentId)
          ?.execute(moveSheetCommand(sheetId, before))) ??
        operationErr("notWritable", `document is not open: ${documentId}`);
      if (!result.ok) {
        record("moveSheet", documentNameOf(documentId), result.error);
      }
      return result;
    },

    async retryDocumentSave(documentId) {
      const session = workspace.getDocumentSession(documentId);
      return session === null ? operationOk(undefined) : session.flush();
    },
    retryFolderSave: (folderId) => workspace.saveFolder(folderId),
    retryProjectSave: () => workspace.saveProject(),
    async saveAll() {
      const drafts = await draftRegistry.commitAll();
      const saved = await workspace.saveAll();
      return drafts.ok ? saved : drafts;
    },

    closeDocumentWithoutSaving: (documentId) =>
      closeDocumentNow(documentId, true),
    reopenProject: reopenProjectNow,

    dismissOperationError(id) {
      uiStateStore.setState((state) => dismissOperationError(state, id));
    },
    setNotificationsOpen(open) {
      uiStateStore.setState((state) => setNotificationsOpen(state, open));
    },
    setSourceEditorLayout(layout) {
      uiStateStore.setState((state) => setSourceEditorLayout(state, layout));
    },
    setSidebarCollapsed(collapsed) {
      uiStateStore.setState((state) => setSidebarCollapsed(state, collapsed));
    },
    setTreeSelection(selection) {
      uiStateStore.setState((state) => setTreeSelection(state, selection));
    },
    revealDocumentInTree(documentId) {
      uiStateStore.setState((state) =>
        setTreeSelection(state, selectOnly(documentTreeKey(documentId))),
      );
    },
    setLeftPanelMode(mode) {
      uiStateStore.setState((state) => setLeftPanelMode(state, mode));
    },
  };
  return actions;
}
