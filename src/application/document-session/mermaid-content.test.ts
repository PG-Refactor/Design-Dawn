import { describe, expect, it } from "vitest";
import { createInMemoryClipboard } from "../clipboard/clipboard";
import { copyBlocks, pasteBlocksCommand } from "../clipboard/copy-paste";
import { editBlockContentCommand } from "../commands/content-commands";
import { withContents } from "../commands/document-data";
import {
  createBlocksCommand,
  deleteBlocksCommand,
} from "../commands/file-backed-commands";
import {
  blockIdOf,
  createSequentialIdGenerator,
  makeBlockAt,
  makeDocumentData,
  position,
  SHEET_ID,
  settle,
  size,
  textOf,
} from "../test-support/fakes";
import {
  openSession,
  TEST_AUTO_SAVE_DELAY_MS,
} from "../test-support/session-harness";

// Mermaid blocks have no application code of their own (docs/architecture.md §15.2-15.3):
// these run the shared text block paths with the `mermaid` type to show that nothing in
// them is Markdown-only. File names and extensions are Rust's (tests/persistence_*.rs).

const MERMAID = makeBlockAt(1, 0, 0, "mermaid");
const NEW_BLOCK = blockIdOf(10);
const SOURCE = "flowchart TD\n  A[Start] --> B[End]";

async function loadedMermaidSession() {
  const harness = openSession([MERMAID]);
  await harness.session.loadSheetContents(SHEET_ID);
  harness.gateway.clearCalls();
  return harness;
}

const edit = (text: string, blockId = MERMAID.blockId) =>
  editBlockContentCommand({ sheetId: SHEET_ID, blockId, text });

const blocksOf = (harness: ReturnType<typeof openSession>) =>
  harness.session.getState().sheets.get(SHEET_ID)?.blocks ?? [];

describe("mermaid blocks on the shared text block paths", () => {
  it("loads the source like any text block", async () => {
    const harness = await loadedMermaidSession();
    const state = harness.session.getState();
    expect(state.contents.get(MERMAID.blockId)).toBe(textOf(MERMAID.blockId));
    expect(state.contentStatus.get(MERMAID.blockId)).toEqual({
      status: "loaded",
    });
  });

  it("creates the block and its file as one history step; undo / redo delete and restore it", async () => {
    const harness = await loadedMermaidSession();
    const { session, gateway } = harness;
    await session.execute(
      createBlocksCommand(SHEET_ID, [
        {
          blockId: NEW_BLOCK,
          blockType: "mermaid",
          position: position(40, 40),
          size: size(480, 320),
          text: `${SOURCE}\r\n`,
        },
      ]),
    );
    expect(gateway.calls.slice(0, 2)).toEqual([
      { method: "createBlockContent", detail: "mermaid" },
      { method: "saveSheet", detail: expect.any(String) },
    ]);
    const created = blocksOf(harness).find(
      (block) => block.blockId === NEW_BLOCK,
    );
    expect(created?.blockType).toBe("mermaid");
    expect(session.getState().contents.get(NEW_BLOCK)).toBe(`${SOURCE}\n`);
    expect(gateway.files.get(created?.contentPath ?? "")).toBe(`${SOURCE}\n`);

    await session.undo();
    expect(blocksOf(harness).some((block) => block.blockId === NEW_BLOCK)).toBe(
      false,
    );
    expect(gateway.files.has(created?.contentPath ?? "")).toBe(false);

    await session.redo();
    expect(
      blocksOf(harness).find((block) => block.blockId === NEW_BLOCK)?.blockType,
    ).toBe("mermaid");
    expect(gateway.files.get(created?.contentPath ?? "")).toBe(`${SOURCE}\n`);
  });

  it("auto-saves an edit as the source file only", async () => {
    const harness = await loadedMermaidSession();
    const { session, gateway, scheduler } = harness;
    await session.execute(edit(SOURCE));
    expect(
      session.getState().save.dirtyContentBlockIds.has(MERMAID.blockId),
    ).toBe(true);
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();
    // The sheet metadata is not rewritten for a source-only edit.
    expect(gateway.methods()).toEqual(["writeBlockContent"]);
    expect(gateway.files.get(MERMAID.contentPath)).toBe(SOURCE);
  });

  it("keeps the saved source in step with undo / redo", async () => {
    const harness = await loadedMermaidSession();
    const { session, gateway } = harness;
    const original = textOf(MERMAID.blockId);
    await session.execute(edit(SOURCE));
    await session.flush();
    expect(gateway.files.get(MERMAID.contentPath)).toBe(SOURCE);

    await session.undo();
    await session.flush();
    expect(session.getState().contents.get(MERMAID.blockId)).toBe(original);
    expect(gateway.files.get(MERMAID.contentPath)).toBe(original);

    await session.redo();
    await session.flush();
    expect(gateway.files.get(MERMAID.contentPath)).toBe(SOURCE);
  });

  it("restores the source of a deleted block, unsaved edits included, on undo", async () => {
    const harness = await loadedMermaidSession();
    const { session, gateway } = harness;
    await session.execute(edit("stateDiagram-v2\n  [*] --> Idle"));
    await session.execute(deleteBlocksCommand(SHEET_ID, [MERMAID.blockId]));
    expect(session.getState().contents.has(MERMAID.blockId)).toBe(false);

    await session.undo();
    const restored = blocksOf(harness).find(
      (block) => block.blockId === MERMAID.blockId,
    );
    expect(restored?.blockType).toBe("mermaid");
    expect(session.getState().contents.get(MERMAID.blockId)).toBe(
      "stateDiagram-v2\n  [*] --> Idle",
    );
    expect(gateway.files.get(restored?.contentPath ?? "")).toBe(
      "stateDiagram-v2\n  [*] --> Idle",
    );
  });

  it("copies and pastes the block type and the current source", async () => {
    const data = withContents(makeDocumentData([MERMAID]), [
      [MERMAID.blockId, SOURCE],
    ]);
    const clipboard = createInMemoryClipboard();
    copyBlocks({
      state: data,
      sheetId: SHEET_ID,
      blockIds: [MERMAID.blockId],
      clipboard,
    });
    const content = clipboard.read();
    if (content === null) throw new Error("clipboard should hold content");
    const command = pasteBlocksCommand({
      content,
      sheetId: SHEET_ID,
      target: position(500, 500),
      idGenerator: createSequentialIdGenerator(),
    });
    if (!command.ok) throw new Error("paste should build");
    expect(command.value.specs).toMatchObject([
      { blockType: "mermaid", text: SOURCE },
    ]);

    const harness = openSession([MERMAID]);
    harness.gateway.clearCalls();
    expect((await harness.session.execute(command.value)).ok).toBe(true);
    expect(harness.gateway.calls[0]).toEqual({
      method: "createBlockContent",
      detail: "mermaid",
    });
    const pasted = blocksOf(harness)[1];
    expect(pasted?.blockType).toBe("mermaid");
    expect(harness.gateway.files.get(pasted?.contentPath ?? "")).toBe(SOURCE);
  });
});
