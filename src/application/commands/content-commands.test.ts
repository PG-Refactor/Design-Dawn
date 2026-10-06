import { describe, expect, it } from "vitest";
import {
  blockIdOf,
  makeBlockAt,
  OTHER_SHEET_ID,
  position,
  SHEET_ID,
  sheetIdOf,
  size,
  textOf,
} from "../test-support/fakes";
import { openSession } from "../test-support/session-harness";
import { moveBlocksCommand, resizeBlocksCommand } from "./block-commands";
import { editBlockContentCommand } from "./content-commands";

const FIRST = blockIdOf(1);
const edit = (text: string, blockId = FIRST) =>
  editBlockContentCommand({ sheetId: SHEET_ID, blockId, text });

async function loadedSession(blocks?: Parameters<typeof openSession>[0]) {
  const harness = openSession(blocks);
  await harness.session.loadSheetContents(SHEET_ID);
  return harness;
}

const textIn = (harness: Awaited<ReturnType<typeof loadedSession>>) =>
  harness.session.getState().contents.get(FIRST);

describe("editBlockContentCommand", () => {
  it("edits, undoes and redoes the text", async () => {
    const harness = await loadedSession();
    const { session } = harness;
    expect((await session.execute(edit("edited"))).ok).toBe(true);
    expect(textIn(harness)).toBe("edited");
    expect(session.getState().history.undoLabel).toBe("editBlockContent");
    await session.undo();
    expect(textIn(harness)).toBe(textOf(FIRST));
    await session.redo();
    expect(textIn(harness)).toBe("edited");
  });

  it("can set empty text", async () => {
    const harness = await loadedSession();
    await harness.session.execute(edit(""));
    expect(textIn(harness)).toBe("");
    await harness.session.undo();
    expect(textIn(harness)).toBe(textOf(FIRST));
  });

  it("normalizes CRLF to LF before storing", async () => {
    const harness = await loadedSession();
    await harness.session.execute(edit("a\r\nb\r\n"));
    expect(textIn(harness)).toBe("a\nb\n");
  });

  it("is a no-op for the same text, also after CRLF normalization", async () => {
    const harness = await loadedSession();
    const { session } = harness;
    const before = session.getState();
    expect((await session.execute(edit(textOf(FIRST)))).ok).toBe(true);
    expect(session.getState()).toBe(before);
    await session.execute(edit("a\nb"));
    const afterEdit = session.getState();
    expect((await session.execute(edit("a\r\nb"))).ok).toBe(true);
    expect(session.getState().contents).toBe(afterEdit.contents);
    expect(session.getState().history.canUndo).toBe(true);
    await session.undo();
    // One real edit only: the no-ops were not pushed.
    expect(session.getState().history.canUndo).toBe(false);
    expect(textIn(harness)).toBe(textOf(FIRST));
  });

  it("keeps unchanged parts by reference", () => {
    const command = edit("x");
    const harness = openSession();
    const data = {
      ...harness.data,
      contents: new Map([[FIRST, "old"]]),
    };
    const applied = command.apply(data);
    expect(applied.ok && applied.value.sheets).toBe(data.sheets);
    expect(applied.ok && applied.value.document).toBe(data.document);
    expect(command.apply(applied.ok ? applied.value : data).ok).toBe(true);
  });

  it("fails without changing state or history", async () => {
    const image = makeBlockAt(9, 0, 0, "image");
    const harness = await loadedSession([makeBlockAt(1), image]);
    const { session } = harness;
    const before = session.getState();
    const cases = [
      [
        editBlockContentCommand({
          sheetId: SHEET_ID,
          blockId: blockIdOf(77),
          text: "x",
        }),
        "entityNotFound",
      ],
      [
        editBlockContentCommand({
          sheetId: OTHER_SHEET_ID,
          blockId: FIRST,
          text: "x",
        }),
        "entityNotFound",
      ],
      [
        editBlockContentCommand({
          sheetId: sheetIdOf(999),
          blockId: FIRST,
          text: "x",
        }),
        "entityNotFound",
      ],
      [edit("x", image.blockId), "unsupportedBlockType"],
    ] as const;
    for (const [command, kind] of cases) {
      const result = await session.execute(command);
      expect(!result.ok && result.error.kind).toBe(kind);
      expect(session.getState()).toBe(before);
    }
  });

  it("refuses to edit content that is not loaded (never requested)", async () => {
    const { session } = openSession();
    const before = session.getState();
    const result = await session.execute(edit("x"));
    expect(!result.ok && result.error.kind).toBe("notWritable");
    expect(session.getState()).toBe(before);
    expect(session.getState().history.canUndo).toBe(false);
  });

  it("refuses to edit content whose load failed", async () => {
    const { session, gateway } = openSession();
    gateway.failOn("readBlockContent", "ioError");
    await session.loadSheetContents(SHEET_ID);
    const result = await session.execute(edit("x"));
    expect(!result.ok && result.error.kind).toBe("notWritable");
    expect(session.getState().contents.has(FIRST)).toBe(false);
    expect(session.getState().save.dirtyContentBlockIds.size).toBe(0);
  });

  it("refuses to revert a command that never applied", () => {
    const harness = openSession();
    const reverted = edit("x").revert(harness.data);
    expect(reverted.ok).toBe(false);
  });

  it("undoes and redoes interleaved metadata and content edits in LIFO order", async () => {
    const harness = await loadedSession();
    const { session } = harness;
    const block = () => session.getState().sheets.get(SHEET_ID)?.blocks[0];
    const snapshot = () => ({
      x: block()?.position.x,
      width: block()?.size.width,
      text: textIn(harness),
    });
    const states = [snapshot()];
    const steps = [
      moveBlocksCommand(SHEET_ID, [
        { blockId: FIRST, position: position(5, 5) },
      ]),
      edit("one"),
      resizeBlocksCommand(SHEET_ID, [
        { blockId: FIRST, position: position(5, 5), size: size(300, 200) },
      ]),
      edit("two"),
    ];
    for (const step of steps) {
      await session.execute(step);
      states.push(snapshot());
    }
    expect(states.map((entry) => entry.text)).toEqual([
      textOf(FIRST),
      textOf(FIRST),
      "one",
      "one",
      "two",
    ]);
    for (let index = states.length - 2; index >= 0; index--) {
      await session.undo();
      expect(snapshot()).toEqual(states[index]);
    }
    for (let index = 1; index < states.length; index++) {
      await session.redo();
      expect(snapshot()).toEqual(states[index]);
    }
  });
});
