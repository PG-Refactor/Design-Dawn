import { describe, expect, it } from "vitest";
import { editBlockContentCommand } from "../../application/commands/content-commands";
import { makeBlockAt } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  SHEET_A1,
} from "../../application/test-support/workspace-harness";
import {
  createActionsHarness,
  reopenedWorkspace,
  seedSheetBlocks,
} from "../workspace/test-support/actions-harness";
import { saveStatusOf } from "../workspace/view-models/tabs-model";

// Save, failure and reload of a Mermaid source through the workspace, over the fake disk.
// The session level twins are in application/document-session/mermaid-save-integration.test.ts.

const MERMAID = makeBlockAt(1, 0, 0, "mermaid");
const EDITED = "flowchart TD\n  A --> B";

async function openedSession() {
  const harness = createActionsHarness();
  seedSheetBlocks(harness, DOCUMENT_A, SHEET_A1, [MERMAID]);
  expect((await harness.actions.openProjectViaDialog()).ok).toBe(true);
  await harness.actions.openDocument(DOCUMENT_A);
  const session = harness.workspace.getDocumentSession(DOCUMENT_A);
  if (session === null) throw new Error("document A must be open");
  await session.loadSheetContents(SHEET_A1);
  return { harness, session };
}

const edit = (text: string) =>
  editBlockContentCommand({
    sheetId: SHEET_A1,
    blockId: MERMAID.blockId,
    text,
  });

describe("the save status of a Mermaid document", () => {
  // Mirrors content-saving.test.ts "keeps the dirty flag and the error on a write failure
  // and retries on flush", at the level of the status the tab shows.
  it("is unsaved after an edit, error after a failed write and saved after the retry", async () => {
    const { harness, session } = await openedSession();
    await session.execute(edit(EDITED));
    expect(saveStatusOf(session.getState())).toBe("unsaved");

    harness.gateway.failOn("writeBlockContent", "ioError");
    expect((await session.flush()).ok).toBe(false);
    expect(saveStatusOf(session.getState())).toBe("error");

    expect((await session.flush()).ok).toBe(true);
    expect(saveStatusOf(session.getState())).toBe("saved");
  });
});

describe("reloading a saved Mermaid source", () => {
  it("is read back, with its block type, by a new workspace over the same disk", async () => {
    const { harness, session } = await openedSession();
    await session.execute(edit(EDITED));
    expect((await session.flush()).ok).toBe(true);

    const { workspace } = await reopenedWorkspace(harness);
    await workspace.openDocument(DOCUMENT_A);
    const restored = workspace.getDocumentSession(DOCUMENT_A);
    if (restored === null) throw new Error("document A must reopen");
    await restored.loadSheetContents(SHEET_A1);

    const state = restored.getState();
    expect(state.contents.get(MERMAID.blockId)).toBe(EDITED);
    expect(state.sheets.get(SHEET_A1)?.blocks[0]?.blockType).toBe("mermaid");
    expect(state.history.canUndo).toBe(false);
  });
});
