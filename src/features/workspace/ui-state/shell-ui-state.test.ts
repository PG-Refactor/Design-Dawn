import { describe, expect, it } from "vitest";
import { documentIdOf } from "../../../application/test-support/fakes";
import {
  addOperationError,
  clearNotice,
  closeDialog,
  dismissOperationError,
  openDialog,
  setBusy,
  setDiffViewMode,
  setGitCommitMessage,
  setGitHistoryExpanded,
  setGitSectionCollapsed,
  setNotificationsOpen,
  showNotice,
} from "./shell-ui-state";
import { createInitialUiState } from "./ui-state";
import { resetUiState } from "./ui-state-cleanup";

const ERROR = { kind: "ioError", detail: "x" } as const;

describe("shell ui state", () => {
  it("starts with no dialog, no errors, closed notifications and not busy", () => {
    const state = createInitialUiState();
    expect(state.dialog).toEqual({ kind: "none" });
    expect(state.operationErrors).toEqual([]);
    expect(state.notificationsOpen).toBe(false);
    expect(state.busy).toBe(false);
  });

  it("opens and closes a dialog; closing none keeps the state object", () => {
    const initial = createInitialUiState();
    expect(closeDialog(initial)).toBe(initial);
    const documentId = documentIdOf(1);
    const opened = openDialog(initial, { kind: "createSheet", documentId });
    expect(opened.dialog).toEqual({ kind: "createSheet", documentId });
    expect(closeDialog(opened).dialog).toEqual({ kind: "none" });
  });

  it("records operation errors with increasing ids and opens the notifications", () => {
    let state = createInitialUiState();
    state = addOperationError(state, "openProject", null, ERROR);
    state = addOperationError(state, "deleteSheet", "Sheet 1", ERROR);
    expect(state.operationErrors.map((entry) => entry.id)).toEqual([1, 2]);
    expect(state.operationErrors[1]).toMatchObject({
      operation: "deleteSheet",
      subject: "Sheet 1",
    });
    expect(state.notificationsOpen).toBe(true);
  });

  it("dismisses one error and never reuses its id", () => {
    let state = createInitialUiState();
    state = addOperationError(state, "openProject", null, ERROR);
    state = addOperationError(state, "openProject", null, ERROR);
    const afterDismiss = dismissOperationError(state, 1);
    expect(afterDismiss.operationErrors.map((entry) => entry.id)).toEqual([2]);
    expect(dismissOperationError(afterDismiss, 99)).toBe(afterDismiss);
    const next = addOperationError(afterDismiss, "openProject", null, ERROR);
    expect(next.operationErrors.map((entry) => entry.id)).toEqual([2, 3]);
  });

  it("toggles notifications and busy without changing equal state", () => {
    const initial = createInitialUiState();
    expect(setNotificationsOpen(initial, false)).toBe(initial);
    expect(setNotificationsOpen(initial, true).notificationsOpen).toBe(true);
    expect(setBusy(initial, false)).toBe(initial);
    expect(setBusy(initial, true).busy).toBe(true);
  });

  it("is cleared with everything else when the project closes", () => {
    const state = openDialog(
      addOperationError(createInitialUiState(), "openProject", null, ERROR),
      { kind: "createDocument", parentFolderId: null },
    );
    expect(state.operationErrors).toHaveLength(1);
    expect(resetUiState()).toEqual(createInitialUiState());
  });
});

describe("light notices", () => {
  it("shows a notice with its own id and replaces the previous one", () => {
    const first = showNotice(createInitialUiState(), "documentAlreadyOpen");
    const second = showNotice(first, "projectOpenInOtherWindow");
    expect(first.notice).toEqual({ id: 1, kind: "documentAlreadyOpen" });
    expect(second.notice).toEqual({
      id: 2,
      kind: "projectOpenInOtherWindow",
    });
  });

  it("clears only the notice that is still shown", () => {
    const state = showNotice(
      showNotice(createInitialUiState(), "documentAlreadyOpen"),
      "projectOpenInThisWindow",
    );
    // The timer of the replaced notice does nothing.
    expect(clearNotice(state, 1)).toBe(state);
    expect(clearNotice(state, 2).notice).toBeNull();
  });
});

describe("git commit message", () => {
  it("defaults to empty, is replaced by the setter and reset with the UI state", () => {
    const initial = createInitialUiState();
    expect(initial.gitCommitMessage).toBe("");
    const typed = setGitCommitMessage(initial, "draft");
    expect(typed.gitCommitMessage).toBe("draft");
    expect(setGitCommitMessage(typed, "draft")).toBe(typed);
    expect(resetUiState().gitCommitMessage).toBe("");
  });
});

describe("git history expanded", () => {
  it("defaults to collapsed, is replaced by the setter and reset with the UI state", () => {
    const initial = createInitialUiState();
    expect(initial.gitHistoryExpanded).toBe(false);
    const expanded = setGitHistoryExpanded(initial, true);
    expect(expanded.gitHistoryExpanded).toBe(true);
    expect(setGitHistoryExpanded(expanded, true)).toBe(expanded);
    expect(resetUiState().gitHistoryExpanded).toBe(false);
  });
});

describe("git collapsed sections", () => {
  it("defaults to none collapsed, toggles per section and resets with the UI state", () => {
    const initial = createInitialUiState();
    expect(initial.gitCollapsedSections.size).toBe(0);
    const collapsed = setGitSectionCollapsed(initial, "staged", true);
    expect(collapsed.gitCollapsedSections.has("staged")).toBe(true);
    expect(collapsed.gitCollapsedSections.has("changes")).toBe(false);
    expect(setGitSectionCollapsed(collapsed, "staged", true)).toBe(collapsed);
    const expanded = setGitSectionCollapsed(collapsed, "staged", false);
    expect(expanded.gitCollapsedSections.size).toBe(0);
    expect(setGitSectionCollapsed(initial, "staged", false)).toBe(initial);
    expect(resetUiState().gitCollapsedSections.size).toBe(0);
  });
});

describe("diff view mode", () => {
  it("defaults to split, is replaced by the setter and resets with the UI state", () => {
    const initial = createInitialUiState();
    expect(initial.diffViewMode).toBe("split");
    const inline = setDiffViewMode(initial, "inline");
    expect(inline.diffViewMode).toBe("inline");
    expect(setDiffViewMode(inline, "inline")).toBe(inline);
    expect(resetUiState().diffViewMode).toBe("split");
  });
});
