import { describe, expect, it } from "vitest";
import { parseDocumentId } from "../../domain/shared/entity-id";
import { DOCUMENT_ID, PROJECT_ID } from "../../domain/shared/test-fixtures";
import { unwrap } from "../../domain/shared/test-support";
import { moveBlocksCommand } from "../commands/block-commands";
import { blockIdOf, position, SHEET_ID } from "../test-support/fakes";
import { openSession } from "../test-support/session-harness";
import {
  connectSessionToStore,
  createApplicationStore,
  moveOpenDocument,
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

describe("moveOpenDocument", () => {
  const SECOND = unwrap(
    parseDocumentId("01928f3a-6c7d-7e8f-a012-3456789abc01"),
  );
  const THIRD = unwrap(parseDocumentId("01928f3a-6c7d-7e8f-a012-3456789abc02"));

  // Three open documents (the same session value under three ids is enough: only the
  // key order matters here).
  function threeOpen() {
    const { session } = openSession();
    const base = session.getState();
    let state = createApplicationStore().getState();
    for (const documentId of [DOCUMENT_ID, SECOND, THIRD]) {
      state = putDocumentSession(state, {
        ...base,
        document: { ...base.document, documentId },
      });
    }
    return state;
  }

  const orderOf = (state: ReturnType<typeof threeOpen>) => [
    ...state.documents.keys(),
  ];

  it("puts a document in front of another, however far, and at the end", () => {
    const state = threeOpen();
    expect(orderOf(moveOpenDocument(state, THIRD, DOCUMENT_ID))).toEqual([
      THIRD,
      DOCUMENT_ID,
      SECOND,
    ]);
    expect(orderOf(moveOpenDocument(state, DOCUMENT_ID, null))).toEqual([
      SECOND,
      THIRD,
      DOCUMENT_ID,
    ]);
    expect(orderOf(moveOpenDocument(state, DOCUMENT_ID, THIRD))).toEqual([
      SECOND,
      DOCUMENT_ID,
      THIRD,
    ]);
  });

  it("keeps the sibling details in the same order and the input untouched", () => {
    const state = threeOpen();
    const moved = moveOpenDocument(state, SECOND, null);
    expect(orderOf(state)).toEqual([DOCUMENT_ID, SECOND, THIRD]);
    expect([...moved.documentDetails.keys()]).toEqual(
      [...moved.documents.keys()].filter((id) => moved.documentDetails.has(id)),
    );
  });

  it("returns the same state when nothing moves or an id is not open", () => {
    const state = threeOpen();
    expect(moveOpenDocument(state, DOCUMENT_ID, DOCUMENT_ID)).toBe(state);
    expect(moveOpenDocument(state, DOCUMENT_ID, SECOND)).toBe(state);
    expect(moveOpenDocument(state, THIRD, null)).toBe(state);
    const closed = removeDocumentSession(state, SECOND);
    expect(moveOpenDocument(closed, SECOND, null)).toBe(closed);
    expect(moveOpenDocument(closed, THIRD, SECOND)).toBe(closed);
  });

  it("keeps the new order when a session is replaced", () => {
    const state = moveOpenDocument(threeOpen(), THIRD, DOCUMENT_ID);
    const current = state.documents.get(DOCUMENT_ID);
    if (current === undefined) throw new Error("expected an open document");
    expect(orderOf(replaceDocumentSession(state, current))).toEqual([
      THIRD,
      DOCUMENT_ID,
      SECOND,
    ]);
  });
});
