// The diff tabs of the main tab strip (docs/ui-design.md §13.5). Pure functions on
// `UiState` like the rest of the UI state; each returns the same state object when nothing
// changes. The tabs are not saved and end with the Project.

import type { DocumentId } from "../../../domain/shared/entity-id";
import {
  COMPARE_MAIN_TAB,
  type CompareContent,
  type DiffTab,
  DOCUMENT_MAIN_TAB,
  type GitSelection,
  type MainTabRef,
  type UiState,
} from "./ui-state";

export function sameSelection(
  first: GitSelection,
  second: GitSelection,
): boolean {
  return first.path === second.path && first.side === second.side;
}

export function findDiffTab(
  state: Pick<UiState, "diffTabs">,
  target: GitSelection,
): DiffTab | undefined {
  return state.diffTabs.find((tab) => sameSelection(tab, target));
}

function diffMainTab(target: GitSelection): MainTabRef {
  return { kind: "diff", path: target.path, side: target.side };
}

export function isActiveDiffTab(
  mainTab: MainTabRef,
  target: GitSelection,
): boolean {
  return mainTab.kind === "diff" && sameSelection(mainTab, target);
}

// The selection of the active diff tab, or null while the Document (or nothing) is shown.
export function activeDiffSelection(
  state: Pick<UiState, "activeMainTab">,
): GitSelection | null {
  const tab = state.activeMainTab;
  return tab.kind === "diff" ? { path: tab.path, side: tab.side } : null;
}

// Shows the Document in the main area (a diff tab, if any, stays open).
export function showDocumentTab(state: UiState): UiState {
  return state.activeMainTab.kind === "document"
    ? state
    : { ...state, activeMainTab: DOCUMENT_MAIN_TAB };
}

// Activates an existing diff tab; unknown targets are ignored.
export function activateDiffTab(state: UiState, target: GitSelection): UiState {
  if (findDiffTab(state, target) === undefined) return state;
  if (isActiveDiffTab(state.activeMainTab, target)) return state;
  return { ...state, activeMainTab: diffMainTab(target) };
}

// Opens the diff as a tab and activates it. An existing tab is only activated (and pinned
// when `pin`). A new preview replaces the existing preview tab in its place, else it is
// appended; a pinned one is always appended.
export function openDiffTab(
  state: UiState,
  target: GitSelection,
  pin: boolean,
): UiState {
  const existing = findDiffTab(state, target);
  if (existing !== undefined) {
    const pinned = pin ? pinDiffTab(state, target) : state;
    return activateDiffTab(pinned, target);
  }
  const tab: DiffTab = { path: target.path, side: target.side, preview: !pin };
  const previewIndex = state.diffTabs.findIndex(
    (candidate) => candidate.preview,
  );
  const diffTabs =
    pin || previewIndex < 0
      ? [...state.diffTabs, tab]
      : state.diffTabs.map((candidate, index) =>
          index === previewIndex ? tab : candidate,
        );
  return { ...state, diffTabs, activeMainTab: diffMainTab(target) };
}

export function pinDiffTab(state: UiState, target: GitSelection): UiState {
  const existing = findDiffTab(state, target);
  if (existing === undefined || !existing.preview) return state;
  return {
    ...state,
    diffTabs: state.diffTabs.map((tab) =>
      tab === existing ? { ...tab, preview: false } : tab,
    ),
  };
}

// The tab that takes over when `removed` goes away: the next one, else the previous one,
// else null (the Document). Same rule as the Document tabs.
export function neighbourDiffTab(
  tabs: readonly GitSelection[],
  removed: GitSelection,
): GitSelection | null {
  const index = tabs.findIndex((tab) => sameSelection(tab, removed));
  if (index < 0) return null;
  return tabs[index + 1] ?? tabs[index - 1] ?? null;
}

export function closeDiffTab(state: UiState, target: GitSelection): UiState {
  if (findDiffTab(state, target) === undefined) return state;
  const diffTabs = state.diffTabs.filter((tab) => !sameSelection(tab, target));
  if (!isActiveDiffTab(state.activeMainTab, target)) {
    return { ...state, diffTabs };
  }
  const neighbour = neighbourDiffTab(state.diffTabs, target);
  return {
    ...state,
    diffTabs,
    activeMainTab:
      neighbour === null ? DOCUMENT_MAIN_TAB : diffMainTab(neighbour),
  };
}

// Replaces the whole set (after a status change retargeted the tabs). `active` must be one
// of `diffTabs` or the Document.
export function replaceDiffTabs(
  state: UiState,
  diffTabs: readonly DiffTab[],
  active: GitSelection | null,
): UiState {
  return {
    ...state,
    diffTabs,
    activeMainTab: active === null ? DOCUMENT_MAIN_TAB : diffMainTab(active),
  };
}

// Opens the compare tab (replacing an earlier one) and shows it.
export function openCompareTab(
  state: UiState,
  documentId: DocumentId,
  path: string,
  content: CompareContent,
): UiState {
  return {
    ...state,
    compareTab: { documentId, path, content },
    activeMainTab: COMPARE_MAIN_TAB,
  };
}

// Sets what the compare tab shows, only while it is still the same comparison.
export function setCompareContent(
  state: UiState,
  documentId: DocumentId,
  path: string,
  content: CompareContent,
): UiState {
  const tab = state.compareTab;
  if (tab === null || tab.documentId !== documentId || tab.path !== path) {
    return state;
  }
  return { ...state, compareTab: { ...tab, content } };
}

export function activateCompareTab(state: UiState): UiState {
  return state.compareTab === null || state.activeMainTab.kind === "compare"
    ? state
    : { ...state, activeMainTab: COMPARE_MAIN_TAB };
}

export function closeCompareTab(state: UiState): UiState {
  if (state.compareTab === null) return state;
  return {
    ...state,
    compareTab: null,
    activeMainTab:
      state.activeMainTab.kind === "compare"
        ? DOCUMENT_MAIN_TAB
        : state.activeMainTab,
  };
}

// Puts back a main tab remembered earlier, if it still exists.
export function restoreMainTab(state: UiState, tab: MainTabRef): UiState {
  if (tab.kind === "diff") return activateDiffTab(state, tab);
  if (tab.kind === "compare") return activateCompareTab(state);
  return showDocumentTab(state);
}
