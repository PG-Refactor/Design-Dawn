import { describe, expect, it } from "vitest";
import type { TextEdit } from "../../domain/diagram/text-edit";
import { editBlockContentCommand } from "../commands/content-commands";
import {
  blockIdOf,
  DOCUMENT_ID,
  makeBlockAt,
  SHEET_ID,
  settle,
} from "../test-support/fakes";
import {
  openSession,
  TEST_AUTO_SAVE_DELAY_MS,
} from "../test-support/session-harness";
import { applyDiagramEdits } from "./apply-diagram-edits";

const MERMAID = makeBlockAt(1, 0, 0, "mermaid");
const MARKDOWN = makeBlockAt(2, 10, 10, "markdown");
const SOURCE = 'pie\n  "Dogs" : 386\n  "Cats" : 85\n';

const replace = (
  from: string,
  to: string,
  source = SOURCE,
  occurrence = 0,
): TextEdit => {
  let start = -1;
  for (let count = 0; count <= occurrence; count += 1) {
    start = source.indexOf(from, start + 1);
  }
  return { start, end: start + from.length, text: to };
};

async function sessionWithSource(source = SOURCE) {
  const harness = openSession([MERMAID, MARKDOWN]);
  await harness.session.loadSheetContents(SHEET_ID);
  await harness.session.execute(
    editBlockContentCommand({
      sheetId: SHEET_ID,
      blockId: MERMAID.blockId,
      text: source,
    }),
  );
  // Start from a clean history so the tests count only the GUI operation's entries.
  harness.session.clearHistory();
  await harness.session.flush();
  harness.gateway.clearCalls();
  return harness;
}

const request = (
  edits: readonly TextEdit[],
  overrides: Partial<Parameters<typeof applyDiagramEdits>[1]> = {},
) => ({
  documentId: DOCUMENT_ID,
  sheetId: SHEET_ID,
  blockId: MERMAID.blockId,
  expectedSource: SOURCE,
  edits,
  ...overrides,
});

const contentOf = (harness: Awaited<ReturnType<typeof sessionWithSource>>) =>
  harness.session.getState().contents.get(MERMAID.blockId);

describe("applyDiagramEdits", () => {
  it("is one history entry that one undo restores", async () => {
    const harness = await sessionWithSource();
    const { session } = harness;
    const outcome = await applyDiagramEdits(
      session,
      request([replace("386", "400")]),
    );
    expect(outcome).toEqual({ ok: true, value: { changed: true } });
    expect(contentOf(harness)).toBe('pie\n  "Dogs" : 400\n  "Cats" : 85\n');
    expect(session.getState().history.canUndo).toBe(true);

    await session.undo();
    expect(contentOf(harness)).toBe(SOURCE);
    expect(session.getState().history.canUndo).toBe(false);

    await session.redo();
    expect(contentOf(harness)).toBe('pie\n  "Dogs" : 400\n  "Cats" : 85\n');
  });

  it("makes several edits of one call a single history entry", async () => {
    const harness = await sessionWithSource();
    const { session } = harness;
    await applyDiagramEdits(
      session,
      request([
        replace("85", "90"),
        replace("Dogs", "Wolves"),
        { start: SOURCE.length, end: SOURCE.length, text: '  "Rats" : 1\n' },
      ]),
    );
    expect(contentOf(harness)).toBe(
      'pie\n  "Wolves" : 386\n  "Cats" : 90\n  "Rats" : 1\n',
    );
    await session.undo();
    expect(contentOf(harness)).toBe(SOURCE);
    expect(session.getState().history.canUndo).toBe(false);
  });

  it("uses the normal auto-save and nothing else", async () => {
    const harness = await sessionWithSource();
    const { session, gateway, scheduler } = harness;
    await applyDiagramEdits(session, request([replace("386", "400")]));
    expect(gateway.calls).toEqual([]);
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();
    expect(gateway.methods()).toEqual(["writeBlockContent"]);
    expect(gateway.files.get(MERMAID.contentPath)).toBe(
      'pie\n  "Dogs" : 400\n  "Cats" : 85\n',
    );
  });

  it.each([
    [
      "overlapping",
      [replace("Dogs", "x"), replace('s" : 386', "y")],
      "overlappingTextEdits",
    ],
    ["out of range", [{ start: 0, end: 999, text: "" }], "invalidTextEdit"],
    [
      "ambiguous",
      [
        { start: 3, end: 3, text: "a" },
        { start: 3, end: 3, text: "b" },
      ],
      "ambiguousTextEdits",
    ],
  ])("rejects %s edits without a command", async (_name, edits, kind) => {
    const harness = await sessionWithSource();
    const { session } = harness;
    const outcome = await applyDiagramEdits(session, request(edits));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error.kind).toBe(kind);
    expect(contentOf(harness)).toBe(SOURCE);
    expect(session.getState().history.canUndo).toBe(false);
  });

  it("rejects a stale expectedSource", async () => {
    const harness = await sessionWithSource();
    const { session } = harness;
    const outcome = await applyDiagramEdits(
      session,
      request([replace("386", "400")], { expectedSource: `${SOURCE}x` }),
    );
    expect(!outcome.ok && outcome.error.kind).toBe("staleContent");
    expect(contentOf(harness)).toBe(SOURCE);
    expect(session.getState().history.canUndo).toBe(false);
  });

  it("rejects edits after the block changed since they were computed", async () => {
    const harness = await sessionWithSource();
    const { session } = harness;
    const edits = [replace("386", "400")];
    await session.execute(
      editBlockContentCommand({
        sheetId: SHEET_ID,
        blockId: MERMAID.blockId,
        text: `${SOURCE}\n`,
      }),
    );
    const outcome = await applyDiagramEdits(session, request(edits));
    expect(!outcome.ok && outcome.error.kind).toBe("staleContent");
  });

  it("runs no command for a no-op", async () => {
    const harness = await sessionWithSource();
    const { session, gateway } = harness;
    for (const edits of [[], [replace("386", "386")]]) {
      const outcome = await applyDiagramEdits(session, request(edits));
      expect(outcome).toEqual({ ok: true, value: { changed: false } });
    }
    expect(session.getState().history.canUndo).toBe(false);
    expect(session.getState().save.dirtyContentBlockIds.size).toBe(0);
    expect(gateway.calls).toEqual([]);
  });

  it("rejects an unloaded block", async () => {
    const harness = openSession([MERMAID]);
    const outcome = await applyDiagramEdits(harness.session, request([]));
    expect(!outcome.ok && outcome.error.kind).toBe("notWritable");
  });

  it("rejects unknown ids and non-Mermaid blocks", async () => {
    const harness = await sessionWithSource();
    const { session } = harness;
    const kindOf = async (overrides: Parameters<typeof request>[1]) => {
      const outcome = await applyDiagramEdits(session, request([], overrides));
      return outcome.ok ? "ok" : outcome.error.kind;
    };
    expect(await kindOf({ blockId: blockIdOf(99) })).toBe("entityNotFound");
    expect(await kindOf({ blockId: MARKDOWN.blockId })).toBe(
      "unsupportedBlockType",
    );
  });

  it("normalises CRLF in the whole text, untouched lines included (existing behaviour)", async () => {
    // Rust returns an external CRLF file as it is (tests/persistence_operations.rs), so
    // loaded text can hold CRLF. The edit set is computed against that text, and the one
    // editBlockContent command then rewrites every line ending to LF.
    const crlfSource = 'pie\r\n  "Dogs" : 386\r\n  "Cats" : 85\r\n';
    const harness = openSession([MERMAID, MARKDOWN]);
    harness.gateway.files.set(MERMAID.contentPath, crlfSource);
    await harness.session.loadSheetContents(SHEET_ID);
    expect(contentOf(harness)).toBe(crlfSource);

    const outcome = await applyDiagramEdits(
      harness.session,
      request([replace("386", "400", crlfSource)], {
        expectedSource: crlfSource,
      }),
    );
    expect(outcome).toEqual({ ok: true, value: { changed: true } });
    expect(contentOf(harness)).toBe('pie\n  "Dogs" : 400\n  "Cats" : 85\n');
    expect(harness.session.getState().history.canUndo).toBe(true);
  });
});
