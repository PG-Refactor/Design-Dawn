import { describe, expect, it } from "vitest";
import {
  blockIdOf,
  DOCUMENT_ID,
  OTHER_SHEET_ID,
  SHEET_ID,
} from "../../../domain/shared/test-fixtures";
import {
  clearImageLoadFailure,
  createInitialUiState,
  getImageLoadFailures,
  markImageLoadFailed,
  pruneBlockReferences,
  setFileDragActive,
} from "./ui-state";
import {
  removeDocumentReferences,
  removeSheetFromUiState,
} from "./ui-state-cleanup";

const first = blockIdOf(1);
const second = blockIdOf(2);

describe("image load failures", () => {
  it("records and clears a failure per sheet, returning the same state when nothing changes", () => {
    const initial = createInitialUiState();
    const failed = markImageLoadFailed(initial, SHEET_ID, first);
    expect([...getImageLoadFailures(failed, SHEET_ID)]).toEqual([first]);
    expect(getImageLoadFailures(failed, OTHER_SHEET_ID).size).toBe(0);
    expect(markImageLoadFailed(failed, SHEET_ID, first)).toBe(failed);
    expect(clearImageLoadFailure(initial, SHEET_ID, first)).toBe(initial);
    const cleared = clearImageLoadFailure(failed, SHEET_ID, first);
    // An empty set is stored as "no entry".
    expect(cleared.imageLoadFailures.size).toBe(0);
  });

  it("is pruned with the blocks that disappear", () => {
    let state = markImageLoadFailed(createInitialUiState(), SHEET_ID, first);
    state = markImageLoadFailed(state, SHEET_ID, second);
    const pruned = pruneBlockReferences(state, SHEET_ID, new Set([second]));
    expect([...getImageLoadFailures(pruned, SHEET_ID)]).toEqual([second]);
  });

  it("is dropped with its sheet or document", () => {
    const state = markImageLoadFailed(createInitialUiState(), SHEET_ID, first);
    expect(
      removeSheetFromUiState(state, DOCUMENT_ID, SHEET_ID).imageLoadFailures
        .size,
    ).toBe(0);
    expect(
      removeDocumentReferences(state, DOCUMENT_ID, [SHEET_ID]).imageLoadFailures
        .size,
    ).toBe(0);
    expect(removeSheetFromUiState(state, DOCUMENT_ID, OTHER_SHEET_ID)).toBe(
      state,
    );
  });
});

describe("file drag state", () => {
  it("toggles without notifying when unchanged", () => {
    const initial = createInitialUiState();
    expect(initial.fileDragActive).toBe(false);
    expect(setFileDragActive(initial, false)).toBe(initial);
    const active = setFileDragActive(initial, true);
    expect(active.fileDragActive).toBe(true);
    expect(setFileDragActive(active, false).fileDragActive).toBe(false);
  });
});
