// UI state of the application shell: the open dialog, reported operation errors, the
// notification panel and the busy flag. Pure functions like the rest of the UI state;
// each returns the same state object when nothing changes.

import type { OperationError } from "../../../application/ports/operation-error";
import type { DialogState, OperationLabel, UiState } from "./ui-state";

export function openDialog(state: UiState, dialog: DialogState): UiState {
  return { ...state, dialog };
}

export function closeDialog(state: UiState): UiState {
  return state.dialog.kind === "none"
    ? state
    : { ...state, dialog: { kind: "none" } };
}

// A new failure opens the (non-modal) panel so it cannot go unnoticed.
export function addOperationError(
  state: UiState,
  operation: OperationLabel,
  subject: string | null,
  error: OperationError,
): UiState {
  return {
    ...state,
    operationErrors: [
      ...state.operationErrors,
      { id: state.nextOperationErrorId, operation, subject, error },
    ],
    nextOperationErrorId: state.nextOperationErrorId + 1,
    notificationsOpen: true,
  };
}

export function dismissOperationError(state: UiState, id: number): UiState {
  const remaining = state.operationErrors.filter((entry) => entry.id !== id);
  return remaining.length === state.operationErrors.length
    ? state
    : { ...state, operationErrors: remaining };
}

export function setNotificationsOpen(state: UiState, open: boolean): UiState {
  return state.notificationsOpen === open
    ? state
    : { ...state, notificationsOpen: open };
}

export function setBusy(state: UiState, busy: boolean): UiState {
  return state.busy === busy ? state : { ...state, busy };
}
