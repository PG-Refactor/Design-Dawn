import { describe, expect, it } from "vitest";
import { editBlockContentCommand } from "../commands/content-commands";
import { makeBlockAt, SHEET_ID, settle, textOf } from "../test-support/fakes";
import {
  openSession,
  TEST_AUTO_SAVE_DELAY_MS,
} from "../test-support/session-harness";

// Boundaries between a Mermaid block's edit, the history, the auto-save and the disk.
// Mermaid has no save path or history of its own (docs/architecture.md §15.2-15.3), so
// each test pins the shared rules with the `mermaid` block type. The Markdown twins are
// named per test.

const MERMAID = makeBlockAt(1, 0, 0, "mermaid");
const EDITED = "flowchart TD\n  A --> B";
const SECOND = "flowchart TD\n  A --> C";

const edit = (text: string) =>
  editBlockContentCommand({
    sheetId: SHEET_ID,
    blockId: MERMAID.blockId,
    text,
  });

async function loadedMermaidSession() {
  const harness = openSession([MERMAID]);
  await harness.session.loadSheetContents(SHEET_ID);
  harness.gateway.clearCalls();
  return harness;
}

describe("history of Mermaid edits", () => {
  it("keeps one history entry per edit, with the shared label and no Mermaid-specific entries", async () => {
    const { session } = await loadedMermaidSession();
    const original = textOf(MERMAID.blockId);
    expect(session.getState().history.canUndo).toBe(false);

    await session.execute(edit(EDITED));
    await session.execute(edit(SECOND));
    expect(session.getState().history.undoLabel).toBe("editBlockContent");

    await session.undo();
    expect(session.getState().contents.get(MERMAID.blockId)).toBe(EDITED);
    expect(session.getState().history.canUndo).toBe(true);
    expect(session.getState().history.canRedo).toBe(true);

    await session.undo();
    expect(session.getState().contents.get(MERMAID.blockId)).toBe(original);
    // Two commits, two undo steps: nothing else was recorded.
    expect(session.getState().history.canUndo).toBe(false);

    await session.redo();
    await session.redo();
    expect(session.getState().contents.get(MERMAID.blockId)).toBe(SECOND);
    expect(session.getState().history.canRedo).toBe(false);
    expect(session.getState().history.undoLabel).toBe("editBlockContent");
  });
});

describe("undo and the auto-save timer", () => {
  it("writes the undone (original) text when undo comes before the timer fires", async () => {
    const { session, gateway, scheduler } = await loadedMermaidSession();
    const original = textOf(MERMAID.blockId);
    await session.execute(edit(EDITED));
    await session.undo();
    expect(gateway.methods()).toEqual([]);

    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();

    // The text is dirty again after the undo (the file is not known to match), so the
    // original is written once; the edited text never reaches the disk.
    expect(gateway.methods()).toEqual(["writeBlockContent"]);
    expect(gateway.files.get(MERMAID.contentPath)).toBe(original);
    expect(session.getState().save.dirtyContentBlockIds.size).toBe(0);
  });

  it("writes the original again when undo comes after the edit was auto-saved", async () => {
    const { session, gateway, scheduler } = await loadedMermaidSession();
    const original = textOf(MERMAID.blockId);
    await session.execute(edit(EDITED));
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();
    expect(gateway.files.get(MERMAID.contentPath)).toBe(EDITED);

    await session.undo();
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();

    expect(gateway.methods()).toEqual([
      "writeBlockContent",
      "writeBlockContent",
    ]);
    expect(gateway.files.get(MERMAID.contentPath)).toBe(original);
    expect(session.getState().save.dirtyContentBlockIds.size).toBe(0);
  });
});

describe("a failed save of a Mermaid source", () => {
  // Mirrors content-saving.test.ts "keeps the dirty flag and the error on a write failure
  // and retries on flush".
  it("keeps the source dirty with the error, shows the error status, and the next flush saves", async () => {
    const { session, gateway } = await loadedMermaidSession();
    const original = textOf(MERMAID.blockId);
    await session.execute(edit(EDITED));
    gateway.failOn("writeBlockContent", "ioError");

    const failed = await session.flush();
    expect(!failed.ok && failed.error.kind).toBe("ioError");
    expect(session.getState().save.lastError?.kind).toBe("ioError");
    expect(
      session.getState().save.dirtyContentBlockIds.has(MERMAID.blockId),
    ).toBe(true);
    expect(gateway.files.get(MERMAID.contentPath)).toBe(original);
    expect(session.getState().contents.get(MERMAID.blockId)).toBe(EDITED);

    expect((await session.flush()).ok).toBe(true);
    expect(gateway.files.get(MERMAID.contentPath)).toBe(EDITED);
    expect(session.getState().save.lastError).toBeNull();
    expect(session.getState().save.dirtyContentBlockIds.size).toBe(0);
  });
});
