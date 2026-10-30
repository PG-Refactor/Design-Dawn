import { describe, expect, it } from "vitest";
import type { DiagramOperation } from "../../domain/diagram/diagram-operation";
import { editBlockContentCommand } from "../commands/content-commands";
import {
  DOCUMENT_ID,
  makeBlockAt,
  SHEET_ID,
  settle,
} from "../test-support/fakes";
import {
  openSession,
  TEST_AUTO_SAVE_DELAY_MS,
} from "../test-support/session-harness";
import { applyValidatedDiagramOperation } from "./apply-validated-diagram-operation";
import type {
  DiagramRenderCheck,
  DiagramRenderCheckOutcome,
} from "./diagram-render-check";

const MERMAID = makeBlockAt(1, 0, 0, "mermaid");
const SOURCE = 'pie\n  "Dogs" : 386\n  "Cats" : 85\n';

const setValue = (valueText: string): DiagramOperation => ({
  diagram: "pie",
  operation: {
    kind: "setSliceValue",
    target: { index: 0, label: "Dogs" },
    valueText,
  },
});

const accept: DiagramRenderCheck = async () => ({ ok: true });

async function sessionWithSource(source = SOURCE) {
  const harness = openSession([MERMAID]);
  await harness.session.loadSheetContents(SHEET_ID);
  await harness.session.execute(
    editBlockContentCommand({
      sheetId: SHEET_ID,
      blockId: MERMAID.blockId,
      text: source,
    }),
  );
  harness.session.clearHistory();
  await harness.session.flush();
  harness.gateway.clearCalls();
  return harness;
}

const request = (operation: DiagramOperation) => ({
  documentId: DOCUMENT_ID,
  sheetId: SHEET_ID,
  blockId: MERMAID.blockId,
  operation,
});

const contentOf = (harness: Awaited<ReturnType<typeof sessionWithSource>>) =>
  harness.session.getState().contents.get(MERMAID.blockId);

function deferredCheck() {
  let resolve: (outcome: DiagramRenderCheckOutcome) => void = () => {};
  const calls: string[] = [];
  const check: DiagramRenderCheck = (source) => {
    calls.push(source);
    return new Promise((done) => {
      resolve = done;
    });
  };
  return {
    check,
    calls,
    resolve: (outcome: DiagramRenderCheckOutcome) => resolve(outcome),
  };
}

describe("applyValidatedDiagramOperation", () => {
  it("commits one history entry that one undo restores, after the render check", async () => {
    const harness = await sessionWithSource();
    const { session } = harness;
    const seen: string[] = [];
    const outcome = await applyValidatedDiagramOperation(
      session,
      request(setValue("400")),
      async (candidate) => {
        seen.push(candidate);
        // Nothing is committed while the check is pending.
        expect(contentOf(harness)).toBe(SOURCE);
        return { ok: true };
      },
    );
    expect(outcome).toEqual({ ok: true, value: { changed: true } });
    expect(seen).toEqual(['pie\n  "Dogs" : 400\n  "Cats" : 85\n']);
    expect(contentOf(harness)).toBe('pie\n  "Dogs" : 400\n  "Cats" : 85\n');
    expect(session.getState().history.canUndo).toBe(true);

    await session.undo();
    expect(contentOf(harness)).toBe(SOURCE);
    expect(session.getState().history.canUndo).toBe(false);
    await session.redo();
    expect(contentOf(harness)).toBe('pie\n  "Dogs" : 400\n  "Cats" : 85\n');
  });

  it("goes through the normal auto-save and nothing else", async () => {
    const harness = await sessionWithSource();
    const { session, gateway, scheduler } = harness;
    await applyValidatedDiagramOperation(
      session,
      request(setValue("1")),
      accept,
    );
    expect(gateway.calls).toEqual([]);
    scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();
    expect(gateway.methods()).toEqual(["writeBlockContent"]);
  });

  it("applies an operation made of several edits as one history entry", async () => {
    const harness = await sessionWithSource();
    const { session } = harness;
    const outcome = await applyValidatedDiagramOperation(
      session,
      request({
        diagram: "pie",
        operation: {
          kind: "moveSlice",
          target: { index: 0, label: "Dogs" },
          toIndex: 1,
        },
      }),
      accept,
    );
    expect(outcome.ok).toBe(true);
    expect(contentOf(harness)).toBe('pie\n  "Cats" : 85\n  "Dogs" : 386\n');
    await session.undo();
    expect(contentOf(harness)).toBe(SOURCE);
    expect(session.getState().history.canUndo).toBe(false);
  });

  it("checks and draws the text that will be stored (CRLF already normalised)", async () => {
    const crlf = 'pie\r\n  "Dogs" : 386\r\n  "Cats" : 85\r\n';
    const harness = openSession([MERMAID]);
    harness.gateway.files.set(MERMAID.contentPath, crlf);
    await harness.session.loadSheetContents(SHEET_ID);
    const seen: string[] = [];
    const outcome = await applyValidatedDiagramOperation(
      harness.session,
      request(setValue("1")),
      async (candidate) => {
        seen.push(candidate);
        return { ok: true };
      },
    );
    expect(outcome.ok).toBe(true);
    expect(seen).toEqual(['pie\n  "Dogs" : 1\n  "Cats" : 85\n']);
    expect(contentOf(harness)).toBe('pie\n  "Dogs" : 1\n  "Cats" : 85\n');
  });

  it("changes nothing and skips the render check when the operation is a no-op", async () => {
    const harness = await sessionWithSource();
    const { session, gateway } = harness;
    const { check, calls } = deferredCheck();
    const outcome = await applyValidatedDiagramOperation(
      session,
      request(setValue("386")),
      check,
    );
    expect(outcome).toEqual({ ok: true, value: { changed: false } });
    expect(calls).toEqual([]);
    expect(session.getState().history.canUndo).toBe(false);
    expect(gateway.calls).toEqual([]);
  });

  it("rejects when the render check fails: content, history and saves are untouched", async () => {
    const harness = await sessionWithSource();
    const { session, gateway } = harness;
    const outcome = await applyValidatedDiagramOperation(
      session,
      request(setValue("400")),
      async () => ({ ok: false, message: "Parse error on line 2" }),
    );
    expect(!outcome.ok && outcome.error.kind).toBe("diagramRenderRejected");
    expect(!outcome.ok && outcome.error.detail).toContain(
      "Parse error on line 2",
    );
    expect(contentOf(harness)).toBe(SOURCE);
    expect(session.getState().history.canUndo).toBe(false);
    expect(session.getState().save.dirtyContentBlockIds.size).toBe(0);
    expect(gateway.calls).toEqual([]);
  });

  it("rejects an operation the domain refuses, before any render", async () => {
    const harness = await sessionWithSource();
    const { session } = harness;
    const { check, calls } = deferredCheck();
    const outcome = await applyValidatedDiagramOperation(
      session,
      request({
        diagram: "pie",
        operation: { kind: "addSlice", label: "Dogs", valueText: "1" },
      }),
      check,
    );
    expect(!outcome.ok && outcome.error.kind).toBe("invalidDiagramOperation");
    expect(calls).toEqual([]);
    expect(contentOf(harness)).toBe(SOURCE);
    expect(session.getState().history.canUndo).toBe(false);
  });

  it("rejects a chart that is not editable", async () => {
    const harness = await sessionWithSource('pie\n  "Dogs" : 1\n  oops\n');
    const outcome = await applyValidatedDiagramOperation(
      harness.session,
      request(setValue("2")),
      accept,
    );
    expect(!outcome.ok && outcome.error.kind).toBe("diagramNotEditable");
    expect(contentOf(harness)).toBe('pie\n  "Dogs" : 1\n  oops\n');
    expect(harness.session.getState().history.canUndo).toBe(false);
  });

  it("rejects a mismatching label target without touching anything", async () => {
    const harness = await sessionWithSource();
    const outcome = await applyValidatedDiagramOperation(
      harness.session,
      request({
        diagram: "pie",
        operation: {
          kind: "deleteSlice",
          target: { index: 0, label: "Cats" },
        },
      }),
      accept,
    );
    expect(!outcome.ok && outcome.error.kind).toBe("invalidDiagramOperation");
    expect(contentOf(harness)).toBe(SOURCE);
  });

  it("rejects as stale when the block changes while the render check is pending", async () => {
    const harness = await sessionWithSource();
    const { session } = harness;
    const pending = deferredCheck();
    const running = applyValidatedDiagramOperation(
      session,
      request(setValue("400")),
      pending.check,
    );
    // Wait until the check has been asked for, then change the block underneath it.
    await settle();
    expect(pending.calls).toHaveLength(1);
    await session.execute(
      editBlockContentCommand({
        sheetId: SHEET_ID,
        blockId: MERMAID.blockId,
        text: `${SOURCE}  %% typed meanwhile\n`,
      }),
    );
    pending.resolve({ ok: true });
    const outcome = await running;
    expect(!outcome.ok && outcome.error.kind).toBe("staleContent");
    // Only the other edit is in the block, and only its history entry exists.
    expect(contentOf(harness)).toBe(`${SOURCE}  %% typed meanwhile\n`);
    await session.undo();
    expect(contentOf(harness)).toBe(SOURCE);
    expect(session.getState().history.canUndo).toBe(false);
  });

  it("rejects unknown and non-Mermaid blocks like the plain edit path", async () => {
    const markdown = makeBlockAt(2, 10, 10, "markdown");
    const harness = openSession([MERMAID, markdown]);
    await harness.session.loadSheetContents(SHEET_ID);
    const outcome = await applyValidatedDiagramOperation(
      harness.session,
      { ...request(setValue("1")), blockId: markdown.blockId },
      accept,
    );
    expect(!outcome.ok && outcome.error.kind).toBe("unsupportedBlockType");
  });
});
