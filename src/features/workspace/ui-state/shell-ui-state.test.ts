import { describe, expect, it } from "vitest";
import { documentIdOf } from "../../../application/test-support/fakes";
import {
  addOperationError,
  clearNotice,
  closeDialog,
  dismissOperationError,
  openDialog,
  setBusy,
  setGitSelection,
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

  it("keeps the state object for an equal Git selection and resets it with the Project", () => {
    const initial = createInitialUiState();
    expect(initial.gitSelection).toBeNull();
    const selected = setGitSelection(initial, { path: "a.md", side: "staged" });
    expect(selected.gitSelection).toEqual({ path: "a.md", side: "staged" });
    expect(setGitSelection(selected, { path: "a.md", side: "staged" })).toBe(
      selected,
    );
    expect(
      setGitSelection(selected, { path: "a.md", side: "unstaged" })
        .gitSelection,
    ).toEqual({ path: "a.md", side: "unstaged" });
    expect(setGitSelection(initial, null)).toBe(initial);
    expect(resetUiState().gitSelection).toBeNull();
  });
});
