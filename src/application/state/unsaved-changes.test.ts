import { describe, expect, it } from "vitest";
import { DOCUMENT_ID } from "../../domain/shared/test-fixtures";
import { openSession } from "../test-support/session-harness";
import {
  createInitialApplicationState,
  type DocumentSessionState,
  putDocumentSession,
  type SaveState,
} from "./application-state";
import {
  hasUnsavedDocumentChanges,
  hasUnsavedProjectChanges,
} from "./unsaved-changes";

function stateWithSave(change: Partial<SaveState>) {
  const { session } = openSession();
  const opened: DocumentSessionState = session.getState();
  const saved: DocumentSessionState = {
    ...opened,
    save: {
      dirtySheetIds: new Set(),
      dirtyContentBlockIds: new Set(),
      documentDirty: false,
      saving: false,
      lastError: null,
      ...change,
    },
  };
  return putDocumentSession(createInitialApplicationState(), saved);
}

describe("unsaved changes", () => {
  it("is false without a Project or documents", () => {
    expect(hasUnsavedProjectChanges(createInitialApplicationState())).toBe(
      false,
    );
  });

  it("is false for a document whose save state is clean", () => {
    expect(hasUnsavedProjectChanges(stateWithSave({}))).toBe(false);
  });

  it.each([
    ["a dirty sheet", { dirtySheetIds: new Set([DOCUMENT_ID]) }],
    ["a dirty content block", { dirtyContentBlockIds: new Set([DOCUMENT_ID]) }],
    ["a dirty document", { documentDirty: true }],
    ["a save in progress", { saving: true }],
    ["a failed save", { lastError: { kind: "ioError", detail: "x" } }],
  ] as const)("is true for %s", (_name, change) => {
    const state = stateWithSave(change as Partial<SaveState>);
    expect(hasUnsavedProjectChanges(state)).toBe(true);
    expect(hasUnsavedDocumentChanges(state, [DOCUMENT_ID])).toBe(true);
  });

  it("ignores documents that are not in the asked list", () => {
    const state = stateWithSave({ documentDirty: true });
    expect(hasUnsavedDocumentChanges(state, [])).toBe(false);
  });
});
