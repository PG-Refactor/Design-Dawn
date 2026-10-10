import { describe, expect, it } from "vitest";
import { makeBlockAt } from "../../../application/test-support/fakes";
import {
  createWorkspaceHarness,
  DOCUMENT_A,
  SELECTION_ID,
  SHEET_A1,
} from "../../../application/test-support/workspace-harness";
import { seedSheetBlocks } from "../test-support/actions-harness";
import {
  createInitialUiState,
  markImageLoadFailed,
} from "../ui-state/ui-state";
import { WORKSPACE_MESSAGES } from "../workspace-messages";
import { selectNotifications } from "./notifications-model";

const NO_THEME_PROBLEMS = { loadIssue: null, saveError: null } as const;

describe("image load failure notifications", () => {
  it("lists a failed image block as a warning with its id and path", async () => {
    const harness = createWorkspaceHarness();
    const image = makeBlockAt(1, 0, 0, "image");
    seedSheetBlocks(harness, DOCUMENT_A, SHEET_A1, [image]);
    await harness.workspace.openProject(SELECTION_ID);
    await harness.workspace.openDocument(DOCUMENT_A);
    const ui = markImageLoadFailed(
      createInitialUiState(),
      SHEET_A1,
      image.blockId,
    );
    const model = selectNotifications({
      messages: WORKSPACE_MESSAGES.ja,
      application: harness.store.getState(),
      operationErrors: [],
      imageLoadFailures: ui.imageLoadFailures,
      theme: NO_THEME_PROBLEMS,
    });
    const items = model.items.filter((item) => item.kind === "imageLoadFailed");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      severity: "warning",
      source: { scope: "document", documentId: DOCUMENT_A },
      details: [
        { label: "ID", value: image.blockId },
        { label: "パス", value: image.contentPath },
      ],
    });
  });

  it("ignores failures of blocks that no longer exist", async () => {
    const harness = createWorkspaceHarness();
    await harness.workspace.openProject(SELECTION_ID);
    await harness.workspace.openDocument(DOCUMENT_A);
    const stale = markImageLoadFailed(
      createInitialUiState(),
      SHEET_A1,
      makeBlockAt(9, 0, 0, "image").blockId,
    );
    const model = selectNotifications({
      messages: WORKSPACE_MESSAGES.ja,
      application: harness.store.getState(),
      operationErrors: [],
      imageLoadFailures: stale.imageLoadFailures,
      theme: NO_THEME_PROBLEMS,
    });
    expect(
      model.items.filter((item) => item.kind === "imageLoadFailed"),
    ).toEqual([]);
  });
});
