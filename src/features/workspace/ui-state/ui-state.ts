// UI State: selection, hover, in-progress drag / resize
// values, viewport and the active tab / sheet. Never saved with the Project, never part
// of undo history, never put into Domain values. A drag or resize lives here until it
// ends; only then does the UI hand ONE application command the committed values.
//
// Everything is a pure function on `UiState`; each returns the same state object when
// nothing changes so store listeners are not notified needlessly.

import type { Viewport } from "../../../application/local-state/viewport";
import type { OperationError } from "../../../application/ports/operation-error";
import type { BlockContentComparison } from "../../../application/ports/persistence-types";
import type {
  BlockId,
  DocumentId,
  EntryId,
  FolderId,
  SheetId,
} from "../../../domain/shared/entity-id";
import { createStore, type Store } from "../../../shared/store/store";
import {
  EMPTY_TREE_SELECTION,
  type TreeSelection,
} from "../view-models/tree-selection";

// Fractional values are allowed here; they are rounded when committed.
export interface DragDelta {
  readonly x: number;
  readonly y: number;
}

export interface FramePreview {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// A point in world coordinates (the space of Block positions).
export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

// How a range selection applies to the current selection when it ends.
export type RangeSelectionMode = "replace" | "toggle";

export type Interaction =
  | { readonly kind: "idle" }
  | {
      readonly kind: "dragging";
      readonly sheetId: SheetId;
      readonly blockIds: readonly BlockId[];
      readonly delta: DragDelta;
    }
  | {
      readonly kind: "resizing";
      readonly sheetId: SheetId;
      readonly blockId: BlockId;
      readonly frame: FramePreview;
    }
  // The selection rectangle. World coordinates, so it stays attached to the canvas
  // content while the view is panned or zoomed. Never part of history.
  | {
      readonly kind: "rangeSelecting";
      readonly sheetId: SheetId;
      readonly start: WorldPoint;
      readonly current: WorldPoint;
      readonly mode: RangeSelectionMode;
    };

// The name an entity had when the user asked; null = its name could not be loaded. The
// text for that case is chosen at render time, so it follows the display language.
export type EntityName = string | null;

// What an operation error is about: a named thing, or blocks that were left out (counted,
// so the sentence is built at render time in the current language).
export interface BlockCountSubject {
  readonly blockCount: number;
}

// An entity whose name could not be loaded; its placeholder text is chosen at render time.
export interface UnnamedSubject {
  readonly unnamed: true;
}

export const UNNAMED_SUBJECT: UnnamedSubject = { unnamed: true };

export type OperationSubject = string | BlockCountSubject | UnnamedSubject;

// The subject of an operation on an entity: its name, or the unnamed placeholder.
export function entitySubject(name: EntityName): OperationSubject {
  return name ?? UNNAMED_SUBJECT;
}

// What the New Project dialog asks for: the Project's name, the place it goes in (a folder
// selection Rust keeps), the name of its own folder there, and whether that place becomes
// the default for the next new Project.
export interface NewProjectRequest {
  readonly name: string;
  readonly locationSelectionId: string;
  readonly folderName: string;
  readonly makeDefaultLocation: boolean;
}

// What a "close with unsaved changes" confirmation is about (auto-save off). The window
// answer is delivered to the pending close request, the others run an action when answered.
export type UnsavedCloseTarget =
  | { readonly kind: "window" }
  | { readonly kind: "project" }
  // Opening / creating another Project closes the current one first.
  | { readonly kind: "openProject" }
  | { readonly kind: "createProject"; readonly request: NewProjectRequest }
  | {
      readonly kind: "document";
      readonly documentId: DocumentId;
      readonly name: EntityName;
    };

// The modal that is open (at most one). Confirmation states carry the entity name as it
// was when the user asked, so the text stays stable while the operation runs.
export type DialogState =
  | { readonly kind: "none" }
  | { readonly kind: "createProject" }
  // `parentFolderId` null = directly under the Project.
  | {
      readonly kind: "createDocument";
      readonly parentFolderId: FolderId | null;
    }
  | {
      readonly kind: "createFolder";
      readonly parentFolderId: FolderId | null;
    }
  | { readonly kind: "createSheet"; readonly documentId: DocumentId }
  // The target picker of "move to..." for a Document or a Folder.
  | {
      readonly kind: "moveEntry";
      // What moves: one entry, or several chosen in the tree.
      readonly entryIds: readonly EntryId[];
      // The name of the first one (the title names it when it is the only one).
      readonly name: EntityName;
    }
  // Several entries chosen in the tree are deleted together, after one confirmation.
  | {
      readonly kind: "confirmDeleteEntries";
      readonly entryIds: readonly EntryId[];
      // Everything that goes, the contents of chosen Folders included.
      readonly documents: number;
      readonly folders: number;
    }
  // Asked after a target was picked while a Document that would move has unsaved changes.
  | {
      readonly kind: "confirmMoveSave";
      // What moves, in order (one from the move picker, any number from a tree drag).
      readonly entryIds: readonly EntryId[];
      // The name of the first one (the title names it when it is the only one).
      readonly name: EntityName;
      readonly targetParentFolderId: FolderId | null;
      // The sibling to stand in front of in the target; null = last.
      readonly beforeEntryId: EntryId | null;
    }
  | {
      readonly kind: "confirmUnsavedClose";
      readonly target: UnsavedCloseTarget;
    }
  | {
      readonly kind: "confirmDeleteFolder";
      readonly folderId: FolderId;
      readonly name: EntityName;
      // What is inside and goes with it (0 and 0 for an empty folder).
      readonly documentsInside: number;
      readonly foldersInside: number;
    }
  | {
      readonly kind: "confirmDeleteDocument";
      readonly documentId: DocumentId;
      readonly name: EntityName;
    }
  | {
      readonly kind: "confirmDeleteSheet";
      readonly documentId: DocumentId;
      readonly sheetId: SheetId;
      readonly name: EntityName;
    }
  // Asked before Git changes are discarded. Carries what the
  // question needs, as it was when the user asked; document names are looked up at render.
  | {
      readonly kind: "confirmDiscardGitChanges";
      readonly targets: readonly DiscardTarget[];
      // Open Documents whose files are among the targets (from `discardImpact`).
      readonly documentIds: readonly DocumentId[];
      readonly projectFilesAffected: boolean;
    }
  // Smart commit: nothing is staged but there are changes; asked
  // before they are all staged. Carries what the commit continues with after the answer.
  | {
      readonly kind: "confirmGitStageAll";
      readonly followUp: GitCommitFollowUp;
      readonly remote: string | null;
    }
  // Which remote to publish the branch to, asked only when there are several. The names
  // are repository text: shown as text only.
  | {
      readonly kind: "chooseGitRemote";
      readonly remoteNames: readonly string[];
      readonly continuation: GitRemoteContinuation;
    };

// What a commit does once it has been made (also `git-commit-flow.ts`).
export type GitCommitFollowUp = "none" | "push" | "sync";

// What goes on after the user has picked a remote.
export type GitRemoteContinuation = "commitAndPush" | "push";

// One file of a discard question: untracked files are deleted, the others restored.
export interface DiscardTarget {
  readonly path: string;
  readonly untracked: boolean;
}

// The user-level operations that can fail and be reported (one value per message).
export const OPERATION_LABELS = [
  "selectFolder",
  "setDefaultProjectLocation",
  "openProject",
  "openLaunchRequest",
  "createProject",
  "closeProject",
  "openDocument",
  "closeDocument",
  "createDocument",
  "createFolder",
  "createSheet",
  "deleteDocument",
  "deleteFolder",
  "deleteSheet",
  "renameDocument",
  "renameFolder",
  "renameSheet",
  "moveDocument",
  "moveFolder",
  "moveEntry",
  "moveSheet",
  "moveBlocks",
  "resizeBlocks",
  "deleteBlocks",
  "reorderBlocks",
  "copyBlocks",
  "cutBlocks",
  "pasteBlocks",
  "duplicateBlocks",
  "createBlock",
  "importImages",
  "importImagesWithoutSheet",
  "editBlockContent",
  "setBlockCaption",
  "editDiagram",
  "loadBlockContents",
  "undo",
  "redo",
  "loadViewport",
  "saveViewport",
  "refreshGitStatus",
  "stageGitFiles",
  "unstageGitFiles",
  "discardGitChanges",
  "reloadExternalChange",
  "checkExternalChange",
  "loadGitDiff",
  "commitGitChanges",
  "undoGitCommit",
  "fetchGit",
  "pullGit",
  "pushGit",
  "publishGit",
  "loadGitHistory",
  "repairLoadIssue",
  "updateFileFormat",
  "moveDocumentToWindow",
  "receiveDocument",
] as const;

export type OperationLabel = (typeof OPERATION_LABELS)[number];

// Light, self-clearing information (not a failure): the user asked for something that was
// already true. Shown briefly and never listed in the notifications panel.
export const NOTICE_KINDS = [
  "documentAlreadyOpen",
  "projectOpenInOtherWindow",
  "projectOpenInThisWindow",
  "documentOpenInOtherWindow",
  "externalReloaded",
  "externalWatchUnavailable",
  "loadIssueRepaired",
  "filesReloaded",
  "fileFormatUpdated",
] as const;

export type NoticeKind = (typeof NOTICE_KINDS)[number];

export interface UiNotice {
  // A new notice replaces the shown one and restarts its timer, so each has its own id.
  readonly id: number;
  readonly kind: NoticeKind;
}

// A failed operation, kept until the user dismisses it. Never swallowed: it is shown in
// the notifications.
export interface OperationErrorEntry {
  readonly id: number;
  readonly operation: OperationLabel;
  // Name of the entity the operation was about, when there was one.
  readonly subject: OperationSubject | null;
  readonly error: OperationError;
}

// The block whose inline editor is open (at most one). Only WHICH block is edited lives
// here; the draft text is local to the editor and reaches the application only when the
// edit is committed.
export interface EditingBlock {
  readonly sheetId: SheetId;
  readonly blockId: BlockId;
}

// The Project Tree row whose name is being edited inline (at most one). Only WHICH row
// lives here; the draft text is local to the input and reaches the application only when
// the rename is committed.
export type RenamingTarget =
  | { readonly kind: "document"; readonly documentId: DocumentId }
  | { readonly kind: "folder"; readonly folderId: FolderId }
  | {
      readonly kind: "sheet";
      readonly documentId: DocumentId;
      readonly sheetId: SheetId;
    };

// What the left panel shows. Window-local, never saved.
export const LEFT_PANEL_MODES = ["project", "git"] as const;

export type LeftPanelMode = (typeof LEFT_PANEL_MODES)[number];

export const DEFAULT_LEFT_PANEL_MODE: LeftPanelMode = "project";

// How a text diff is laid out: two columns (old | new) or one column with both numbers.
export const DIFF_VIEW_MODES = ["split", "inline"] as const;

export type DiffViewMode = (typeof DIFF_VIEW_MODES)[number];

export const DEFAULT_DIFF_VIEW_MODE: DiffViewMode = "split";

export interface UiState {
  readonly activeDocumentId: DocumentId | null;
  readonly activeSheetIdByDocument: ReadonlyMap<DocumentId, SheetId>;
  readonly selectionBySheet: ReadonlyMap<SheetId, ReadonlySet<BlockId>>;
  readonly hoveredBlockId: BlockId | null;
  readonly interaction: Interaction;
  readonly editingBlock: EditingBlock | null;
  readonly renaming: RenamingTarget | null;
  // Folders the user folded in the Project Tree. Folders are expanded by default, so the
  // set holds the exceptions; like the rest of the tree's presentation it is not persisted.
  readonly collapsedFolderIds: ReadonlySet<FolderId>;
  // The rows chosen in the Project Tree, as in VS Code's Explorer: new folders and
  // Documents go where the active one is, a drag moves them all, and the choice follows the
  // Document being worked on. Nothing chosen: new entries go to the Project's top level.
  // Dropped with the Project.
  readonly treeSelection: TreeSelection;
  readonly viewportBySheet: ReadonlyMap<SheetId, Viewport>;
  // Image blocks whose picture could not be loaded by the `<img>` (the browser reports it,
  // so only the UI knows). Listed in the notifications; cleared when a later load works.
  readonly imageLoadFailures: ReadonlyMap<SheetId, ReadonlySet<BlockId>>;
  // Files are being dragged over the window (Rust reports it): the canvas shows a drop hint.
  readonly fileDragActive: boolean;
  readonly dialog: DialogState;
  readonly operationErrors: readonly OperationErrorEntry[];
  readonly nextOperationErrorId: number;
  readonly notificationsOpen: boolean;
  readonly notice: UiNotice | null;
  readonly nextNoticeId: number;
  // A workspace operation is running; repeated clicks are disabled meanwhile.
  readonly busy: boolean;
  // Project Tree or Git panel in the sidebar. Kept across Project changes (only the Git
  // content follows the Project).
  readonly leftPanelMode: LeftPanelMode;
  // The sidebar (Project Tree / Git panel) is folded away, leaving the document area the
  // whole width. A view choice of this window, kept across Project changes; never saved.
  readonly sidebarCollapsed: boolean;
  // Side-by-side or inline diff. A view preference of this window shared by all diff tabs;
  // kept across Project changes (like `leftPanelMode`) and never saved.
  readonly diffViewMode: DiffViewMode;
  // The diff tabs of the main tab strip, shown after the Document tabs. A view choice only
  // (the Git state itself lives in the Git controller); dropped when the Project changes.
  readonly diffTabs: readonly DiffTab[];
  // What the main area shows: the active Document (`activeDocumentId`, application state)
  // or one of the diff tabs. Always names an existing diff tab when it is `diff`.
  readonly activeMainTab: MainTabRef;
  // The compare tab after the diff tabs, if one is open.
  readonly compareTab: CompareTab | null;
  // The commit message typed in the Git panel. UI state so it survives switching between
  // the Project and Git views; dropped with the Project and never saved.
  readonly gitCommitMessage: string;
  // Whether the history section of the Git panel is expanded. A view choice kept across
  // Project | Git switches; dropped with the Project.
  readonly gitHistoryExpanded: boolean;
  // Sections of the Git change list the user collapsed (all are expanded by default). A view
  // choice kept across Project | Git switches; dropped with the Project and never saved.
  readonly gitCollapsedSections: ReadonlySet<GitChangeSectionId>;
}

// The sections of the Git change list in display order. Defined
// here because the UI state records which of them are collapsed.
export const GIT_CHANGE_SECTION_IDS = [
  "conflicts",
  "staged",
  "changes",
] as const;

export type GitChangeSectionId = (typeof GIT_CHANGE_SECTION_IDS)[number];

// Which side of a file the Git panel selected: `staged` for rows of the staged section,
// `unstaged` for rows of the changes and untracked sections.
export const GIT_SELECTION_SIDES = ["staged", "unstaged"] as const;

export type GitSelectionSide = (typeof GIT_SELECTION_SIDES)[number];

// A file side whose diff can be shown; the identity of a diff tab.
export interface GitSelection {
  // Project root relative, `/` separated.
  readonly path: string;
  readonly side: GitSelectionSide;
}

export interface DiffTab extends GitSelection {
  // A preview tab is replaced by the next preview; pinning keeps it.
  readonly preview: boolean;
}

// Where the comparison of an externally changed Block text stands.
export type CompareContent =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly comparison: BlockContentComparison }
  // The text in memory is not loaded, or the comparison failed (the failure is reported).
  | { readonly status: "unavailable" };

// The compare tab: a Block text file of an open Document, disk against memory. At most one;
// a new comparison replaces it. A view only: ends with the Project or the Document.
export interface CompareTab {
  readonly documentId: DocumentId;
  // Document-root-relative content path.
  readonly path: string;
  readonly content: CompareContent;
}

export type MainTabRef =
  | { readonly kind: "document" }
  | ({ readonly kind: "diff" } & GitSelection)
  | { readonly kind: "compare" };

export const DOCUMENT_MAIN_TAB: MainTabRef = { kind: "document" };
export const COMPARE_MAIN_TAB: MainTabRef = { kind: "compare" };

export type UiStateStore = Store<UiState>;

const IDLE: Interaction = { kind: "idle" };
const NO_DIALOG: DialogState = { kind: "none" };

export function createInitialUiState(): UiState {
  return {
    activeDocumentId: null,
    activeSheetIdByDocument: new Map(),
    selectionBySheet: new Map(),
    hoveredBlockId: null,
    interaction: IDLE,
    editingBlock: null,
    renaming: null,
    collapsedFolderIds: new Set(),
    treeSelection: EMPTY_TREE_SELECTION,
    viewportBySheet: new Map(),
    imageLoadFailures: new Map(),
    fileDragActive: false,
    dialog: NO_DIALOG,
    operationErrors: [],
    nextOperationErrorId: 1,
    notificationsOpen: false,
    notice: null,
    nextNoticeId: 1,
    busy: false,
    leftPanelMode: DEFAULT_LEFT_PANEL_MODE,
    sidebarCollapsed: false,
    diffViewMode: DEFAULT_DIFF_VIEW_MODE,
    diffTabs: [],
    activeMainTab: DOCUMENT_MAIN_TAB,
    compareTab: null,
    gitCommitMessage: "",
    gitHistoryExpanded: false,
    gitCollapsedSections: new Set(),
  };
}

export function createUiStateStore(): UiStateStore {
  return createStore(createInitialUiState());
}

export function getSelection(
  state: UiState,
  sheetId: SheetId,
): ReadonlySet<BlockId> {
  return state.selectionBySheet.get(sheetId) ?? EMPTY_SELECTION;
}

const EMPTY_SELECTION: ReadonlySet<BlockId> = new Set();

function sameMembers(
  first: ReadonlySet<BlockId>,
  second: ReadonlySet<BlockId>,
): boolean {
  return first.size === second.size && [...first].every((id) => second.has(id));
}

// An empty selection is stored as "no entry" so the map does not grow with sheets the
// user merely visited.
function withSelection(
  state: UiState,
  sheetId: SheetId,
  selection: ReadonlySet<BlockId>,
): UiState {
  if (sameMembers(getSelection(state, sheetId), selection)) return state;
  const selectionBySheet = new Map(state.selectionBySheet);
  if (selection.size === 0) {
    selectionBySheet.delete(sheetId);
  } else {
    selectionBySheet.set(sheetId, selection);
  }
  return { ...state, selectionBySheet };
}

export function selectBlocks(
  state: UiState,
  sheetId: SheetId,
  blockIds: readonly BlockId[],
): UiState {
  return withSelection(state, sheetId, new Set(blockIds));
}

export function toggleBlockSelection(
  state: UiState,
  sheetId: SheetId,
  blockId: BlockId,
): UiState {
  const selection = new Set(getSelection(state, sheetId));
  if (!selection.delete(blockId)) selection.add(blockId);
  return withSelection(state, sheetId, selection);
}

export function clearSelection(state: UiState, sheetId: SheetId): UiState {
  return withSelection(state, sheetId, EMPTY_SELECTION);
}

export function setHoveredBlock(
  state: UiState,
  blockId: BlockId | null,
): UiState {
  return state.hoveredBlockId === blockId
    ? state
    : { ...state, hoveredBlockId: blockId };
}

export function startDrag(
  state: UiState,
  sheetId: SheetId,
  blockIds: readonly BlockId[],
): UiState {
  return {
    ...state,
    interaction: {
      kind: "dragging",
      sheetId,
      blockIds,
      delta: { x: 0, y: 0 },
    },
  };
}

// Ignored unless a drag is in progress (a late pointer event after cancel).
export function updateDrag(state: UiState, delta: DragDelta): UiState {
  const { interaction } = state;
  if (interaction.kind !== "dragging") return state;
  return { ...state, interaction: { ...interaction, delta } };
}

export function startResize(
  state: UiState,
  sheetId: SheetId,
  blockId: BlockId,
  frame: FramePreview,
): UiState {
  return {
    ...state,
    interaction: { kind: "resizing", sheetId, blockId, frame },
  };
}

export function updateResize(state: UiState, frame: FramePreview): UiState {
  const { interaction } = state;
  if (interaction.kind !== "resizing") return state;
  return { ...state, interaction: { ...interaction, frame } };
}

export function startRangeSelection(
  state: UiState,
  sheetId: SheetId,
  start: WorldPoint,
  mode: RangeSelectionMode,
): UiState {
  return {
    ...state,
    interaction: {
      kind: "rangeSelecting",
      sheetId,
      start,
      current: start,
      mode,
    },
  };
}

// Ignored unless a range selection is in progress (a late pointer event after cancel).
export function updateRangeSelection(
  state: UiState,
  current: WorldPoint,
): UiState {
  const { interaction } = state;
  if (interaction.kind !== "rangeSelecting") return state;
  return { ...state, interaction: { ...interaction, current } };
}

// Ends or cancels a drag / resize / range selection. The caller reads `state.interaction` first when it
// needs the final values to commit.
export function endInteraction(state: UiState): UiState {
  return state.interaction.kind === "idle"
    ? state
    : { ...state, interaction: IDLE };
}

export function startEditing(
  state: UiState,
  sheetId: SheetId,
  blockId: BlockId,
): UiState {
  const { editingBlock } = state;
  if (editingBlock?.sheetId === sheetId && editingBlock.blockId === blockId) {
    return state;
  }
  return { ...state, editingBlock: { sheetId, blockId } };
}

// Only ends the edit of THIS block: a late "finished" from an editor that was already
// replaced by another one must not close the new one.
export function stopEditing(
  state: UiState,
  sheetId: SheetId,
  blockId: BlockId,
): UiState {
  const { editingBlock } = state;
  if (editingBlock?.sheetId !== sheetId || editingBlock.blockId !== blockId) {
    return state;
  }
  return { ...state, editingBlock: null };
}

// For when the canvas of a sheet goes away (another sheet is shown): whatever is edited
// there ends. The editor commits its own draft when it unmounts.
export function stopEditingSheet(state: UiState, sheetId: SheetId): UiState {
  return state.editingBlock?.sheetId === sheetId
    ? { ...state, editingBlock: null }
    : state;
}

export function sameRenamingTarget(
  first: RenamingTarget | null,
  second: RenamingTarget | null,
): boolean {
  if (first === null || second === null) return first === second;
  if (first.kind === "folder") {
    return second.kind === "folder" && first.folderId === second.folderId;
  }
  if (first.kind === "document") {
    return second.kind === "document" && first.documentId === second.documentId;
  }
  return (
    second.kind === "sheet" &&
    first.documentId === second.documentId &&
    first.sheetId === second.sheetId
  );
}

// Starting a rename replaces another one that is open: only one input exists at a time.
export function beginRenaming(state: UiState, target: RenamingTarget): UiState {
  return sameRenamingTarget(state.renaming, target)
    ? state
    : { ...state, renaming: target };
}

export function isFolderCollapsed(state: UiState, folderId: FolderId): boolean {
  return state.collapsedFolderIds.has(folderId);
}

export function setFolderCollapsed(
  state: UiState,
  folderId: FolderId,
  collapsed: boolean,
): UiState {
  if (state.collapsedFolderIds.has(folderId) === collapsed) return state;
  const collapsedFolderIds = new Set(state.collapsedFolderIds);
  if (collapsed) collapsedFolderIds.add(folderId);
  else collapsedFolderIds.delete(folderId);
  return { ...state, collapsedFolderIds };
}

export function endRenaming(state: UiState): UiState {
  return state.renaming === null ? state : { ...state, renaming: null };
}

export function setViewport(
  state: UiState,
  sheetId: SheetId,
  viewport: Viewport,
): UiState {
  if (state.viewportBySheet.get(sheetId) === viewport) return state;
  return {
    ...state,
    viewportBySheet: new Map(state.viewportBySheet).set(sheetId, viewport),
  };
}

export function setFileDragActive(state: UiState, active: boolean): UiState {
  return state.fileDragActive === active
    ? state
    : { ...state, fileDragActive: active };
}

const NO_IMAGE_FAILURES: ReadonlySet<BlockId> = new Set();

export function getImageLoadFailures(
  state: UiState,
  sheetId: SheetId,
): ReadonlySet<BlockId> {
  return state.imageLoadFailures.get(sheetId) ?? NO_IMAGE_FAILURES;
}

function withImageLoadFailures(
  state: UiState,
  sheetId: SheetId,
  failures: ReadonlySet<BlockId>,
): UiState {
  if (sameMembers(getImageLoadFailures(state, sheetId), failures)) return state;
  const imageLoadFailures = new Map(state.imageLoadFailures);
  // Like the selection: an empty set is "no entry".
  if (failures.size === 0) {
    imageLoadFailures.delete(sheetId);
  } else {
    imageLoadFailures.set(sheetId, failures);
  }
  return { ...state, imageLoadFailures };
}

export function markImageLoadFailed(
  state: UiState,
  sheetId: SheetId,
  blockId: BlockId,
): UiState {
  return withImageLoadFailures(
    state,
    sheetId,
    new Set([...getImageLoadFailures(state, sheetId), blockId]),
  );
}

export function clearImageLoadFailure(
  state: UiState,
  sheetId: SheetId,
  blockId: BlockId,
): UiState {
  const remaining = new Set(getImageLoadFailures(state, sheetId));
  remaining.delete(blockId);
  return withImageLoadFailures(state, sheetId, remaining);
}

export function setActiveDocument(
  state: UiState,
  documentId: DocumentId | null,
): UiState {
  return state.activeDocumentId === documentId
    ? state
    : { ...state, activeDocumentId: documentId };
}

export function setActiveSheet(
  state: UiState,
  documentId: DocumentId,
  sheetId: SheetId,
): UiState {
  if (state.activeSheetIdByDocument.get(documentId) === sheetId) return state;
  return {
    ...state,
    activeSheetIdByDocument: new Map(state.activeSheetIdByDocument).set(
      documentId,
      sheetId,
    ),
  };
}

// For when blocks of `sheetId` disappear (delete, undo of create): drops selected ids
// that no longer exist, clears a hover on a missing block (hover only ever points into
// the sheet being edited), and cancels an interaction that references a missing block.
export function pruneBlockReferences(
  state: UiState,
  sheetId: SheetId,
  existingBlockIds: ReadonlySet<BlockId>,
): UiState {
  const selection = getSelection(state, sheetId);
  const kept = [...selection].filter((id) => existingBlockIds.has(id));
  let next = withSelection(state, sheetId, new Set(kept));
  next = withImageLoadFailures(
    next,
    sheetId,
    new Set(
      [...getImageLoadFailures(next, sheetId)].filter((id) =>
        existingBlockIds.has(id),
      ),
    ),
  );
  if (
    next.hoveredBlockId !== null &&
    !existingBlockIds.has(next.hoveredBlockId)
  ) {
    next = { ...next, hoveredBlockId: null };
  }
  if (referencesMissingBlock(next.interaction, sheetId, existingBlockIds)) {
    next = { ...next, interaction: IDLE };
  }
  const { editingBlock } = next;
  if (
    editingBlock?.sheetId === sheetId &&
    !existingBlockIds.has(editingBlock.blockId)
  ) {
    next = { ...next, editingBlock: null };
  }
  return next;
}

function referencesMissingBlock(
  interaction: Interaction,
  sheetId: SheetId,
  existingBlockIds: ReadonlySet<BlockId>,
): boolean {
  if (interaction.kind === "dragging") {
    return (
      interaction.sheetId === sheetId &&
      interaction.blockIds.some((id) => !existingBlockIds.has(id))
    );
  }
  if (interaction.kind === "resizing") {
    return (
      interaction.sheetId === sheetId &&
      !existingBlockIds.has(interaction.blockId)
    );
  }
  return false;
}
