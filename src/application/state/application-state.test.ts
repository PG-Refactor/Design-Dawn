import { describe, expect, it } from "vitest";
import { DOCUMENT_ID, PROJECT_ID } from "../../domain/shared/test-fixtures";
import { moveBlocksCommand } from "../commands/block-commands";
import { blockIdOf, position, SHEET_ID } from "../test-support/fakes";
import { openSession } from "../test-support/session-harness";
import {
  connectSessionToStore,
  createApplicationStore,
  putDocumentSession,
  removeDocumentSession,
  replaceDocumentSession,
  setOpenProject,
} from "./application-state";

describe("application state helpers", () => {
  it("puts, replaces and removes document sessions immutably", () => {
    const { session } = openSession();
    const initial = createApplicationStore().getState();
    const withDocument = putDocumentSession(initial, session.getState());
    expect(initial.documents.size).toBe(0);
    expect(withDocument.documents.get(DOCUMENT_ID)).toBe(session.getState());

    const replaced = replaceDocumentSession(withDocument, session.getState());
    expect(replaced).not.toBe(withDocument);

    const removed = removeDocumentSession(withDocument, DOCUMENT_ID);
    expect(removed.documents.size).toBe(0);
    expect(withDocument.documents.size).toBe(1);
    expect(removeDocumentSession(removed, DOCUMENT_ID)).toBe(removed);
  });

  it("does not bring back a closed document on replace", () => {
    const { session } = openSession();
    const empty = createApplicationStore().getState();
    expect(replaceDocumentSession(empty, session.getState())).toBe(empty);
  });

  it("keeps the same state when the project does not change", () => {
    const state = createApplicationStore().getState();
    expect(setOpenProject(state, null)).toBe(state);
    expect(PROJECT_ID).toBeDefined();
  });
});

describe("connectSessionToStore", () => {
  it("updates the store whenever the session publishes", async () => {
    const harness = openSession();
    const store = createApplicationStore();
    store.setState((state) =>
      putDocumentSession(state, harness.session.getState()),
    );
    const onChange = connectSessionToStore(store);
    for (const state of [harness.session.getState()]) onChange(state);
    await harness.session.execute(
      moveBlocksCommand(SHEET_ID, [
        { blockId: blockIdOf(1), position: position(5, 5) },
      ]),
    );
    harness.states.forEach(onChange);
    const stored = store.getState().documents.get(DOCUMENT_ID);
    expect(stored).toBe(harness.states.at(-1));
    expect(stored?.history.canUndo).toBe(true);
  });
});
