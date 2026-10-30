import { describe, expect, it } from "vitest";
import type { DiagramOperation } from "../../domain/diagram/diagram-operation";
import { GANTT_MAX_SOURCE_LENGTH } from "../../domain/diagram/gantt/gantt-config";
import type { GanttOperation } from "../../domain/diagram/gantt/gantt-operations";
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
const SOURCE =
  "gantt\n    dateFormat YYYY-MM-DD\n    section Design\n    Spec :s1, 2024-01-01, 3d\n    Review :s2, after s1, 2d\n";
const SPEC = { index: 0, name: "Spec" };
const REVIEW = { index: 1, name: "Review" };

const gantt = (operation: GanttOperation): DiagramOperation => ({
  diagram: "gantt",
  operation,
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
type Harness = Awaited<ReturnType<typeof sessionWithSource>>;

const request = (operation: DiagramOperation) => ({
  documentId: DOCUMENT_ID,
  sheetId: SHEET_ID,
  blockId: MERMAID.blockId,
  operation,
});
const contentOf = (harness: Harness) =>
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

function expectUntouched(harness: Harness, source: string) {
  expect(contentOf(harness)).toBe(source);
  expect(harness.session.getState().history.canUndo).toBe(false);
  expect(harness.session.getState().save.dirtyContentBlockIds.size).toBe(0);
  expect(harness.gateway.calls).toEqual([]);
}

describe("applyValidatedDiagramOperation with a gantt chart", () => {
  it("commits one undo entry after the render check, and redo restores it", async () => {
    const harness = await sessionWithSource();
    const { session } = harness;
    const seen: string[] = [];
    const outcome = await applyValidatedDiagramOperation(
      session,
      request(gantt({ kind: "setDuration", target: SPEC, duration: "5d" })),
      async (candidate) => {
        seen.push(candidate);
        expect(contentOf(harness)).toBe(SOURCE);
        return { ok: true };
      },
    );
    expect(outcome).toEqual({ ok: true, value: { changed: true } });
    const expected = SOURCE.replace("3d", "5d");
    expect(seen).toEqual([expected]);
    expect(contentOf(harness)).toBe(expected);
    await session.undo();
    expect(contentOf(harness)).toBe(SOURCE);
    expect(session.getState().history.canUndo).toBe(false);
    await session.redo();
    expect(contentOf(harness)).toBe(expected);
  });

  it("goes through the normal auto-save and nothing else", async () => {
    const harness = await sessionWithSource();
    await applyValidatedDiagramOperation(
      harness.session,
      request(gantt({ kind: "setTitle", title: "Plan" })),
      accept,
    );
    expect(harness.gateway.calls).toEqual([]);
    harness.scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();
    expect(harness.gateway.methods()).toEqual(["writeBlockContent"]);
    expect(contentOf(harness)).toBe(
      SOURCE.replace("gantt\n", "gantt\n    title Plan\n"),
    );
  });

  it("applies an operation made of several edits as one history entry", async () => {
    const harness = await sessionWithSource();
    const outcome = await applyValidatedDiagramOperation(
      harness.session,
      request(gantt({ kind: "setTaskId", target: SPEC, id: "spec" })),
      accept,
    );
    expect(outcome.ok).toBe(true);
    // The id and the `after` reference that names it change together.
    expect(contentOf(harness)).toBe(
      SOURCE.replace("s1, 2024", "spec, 2024").replace(
        "after s1",
        "after spec",
      ),
    );
    await harness.session.undo();
    expect(contentOf(harness)).toBe(SOURCE);
    expect(harness.session.getState().history.canUndo).toBe(false);
  });

  it("skips the render check and history for a no-op", async () => {
    const harness = await sessionWithSource();
    const { check, calls } = deferredCheck();
    const outcome = await applyValidatedDiagramOperation(
      harness.session,
      request(gantt({ kind: "setDuration", target: SPEC, duration: "3d" })),
      check,
    );
    expect(outcome).toEqual({ ok: true, value: { changed: false } });
    expect(calls).toEqual([]);
    expectUntouched(harness, SOURCE);
  });

  it("checks the text that will be stored (CRLF already normalised)", async () => {
    const harness = openSession([MERMAID]);
    harness.gateway.files.set(
      MERMAID.contentPath,
      "gantt\r\n    dateFormat YYYY-MM-DD\r\n    A :a1, 2024-01-01, 1d\r\n",
    );
    await harness.session.loadSheetContents(SHEET_ID);
    const seen: string[] = [];
    const outcome = await applyValidatedDiagramOperation(
      harness.session,
      request(gantt({ kind: "setTitle", title: "T" })),
      async (candidate) => {
        seen.push(candidate);
        return { ok: true };
      },
    );
    expect(outcome.ok).toBe(true);
    expect(seen).toEqual([
      "gantt\n    title T\n    dateFormat YYYY-MM-DD\n    A :a1, 2024-01-01, 1d\n",
    ]);
  });

  describe("refusals leave content, history and save state unchanged", () => {
    it("render check failure -> diagramRenderRejected", async () => {
      const harness = await sessionWithSource();
      const outcome = await applyValidatedDiagramOperation(
        harness.session,
        request(gantt({ kind: "setDuration", target: SPEC, duration: "5d" })),
        async () => ({ ok: false, message: "Parse error on line 2" }),
      );
      expect(!outcome.ok && outcome.error.kind).toBe("diagramRenderRejected");
      expect(!outcome.ok && outcome.error.detail).toContain(
        "Parse error on line 2",
      );
      expectUntouched(harness, SOURCE);
    });

    it.each<[string, GanttOperation]>([
      [
        "a task name with a colon",
        { kind: "renameTask", target: SPEC, name: "a: b" },
      ],
      [
        "an impossible date",
        {
          kind: "setStart",
          target: SPEC,
          start: { kind: "date", text: "2024-02-30" },
        },
      ],
      [
        "a stale target",
        { kind: "renameTask", target: { index: 0, name: "Old" }, name: "x" },
      ],
      [
        "deleting a task another task depends on",
        { kind: "deleteTask", target: SPEC },
      ],
      ["a duplicate task id", { kind: "setTaskId", target: REVIEW, id: "s1" }],
    ])(
      "domain refusal (%s) -> invalidDiagramOperation, no render",
      async (_name, operation) => {
        const harness = await sessionWithSource();
        const { check, calls } = deferredCheck();
        const outcome = await applyValidatedDiagramOperation(
          harness.session,
          request(gantt(operation)),
          check,
        );
        expect(!outcome.ok && outcome.error.kind).toBe(
          "invalidDiagramOperation",
        );
        expect(calls).toEqual([]);
        expectUntouched(harness, SOURCE);
      },
    );

    it("a chart that is not editable -> diagramNotEditable", async () => {
      const source = "gantt\n    dateFormat YYYY-MM-DD\n    topAxis\n";
      const harness = await sessionWithSource(source);
      const { check, calls } = deferredCheck();
      const outcome = await applyValidatedDiagramOperation(
        harness.session,
        request(gantt({ kind: "setTitle", title: "x" })),
        check,
      );
      expect(!outcome.ok && outcome.error.kind).toBe("diagramNotEditable");
      expect(calls).toEqual([]);
      expectUntouched(harness, source);
    });

    it("an operation that would push the text over the length limit is refused", async () => {
      const padding = `    %% ${"x".repeat(GANTT_MAX_SOURCE_LENGTH - 160)}\n`;
      const source = `${SOURCE}${padding}`;
      expect(source.length).toBeLessThanOrEqual(GANTT_MAX_SOURCE_LENGTH);
      const harness = await sessionWithSource(source);
      const { check, calls } = deferredCheck();
      const outcome = await applyValidatedDiagramOperation(
        harness.session,
        request(gantt({ kind: "setTitle", title: "y".repeat(400) })),
        check,
      );
      expect(outcome.ok).toBe(false);
      expect(calls).toEqual([]);
      expectUntouched(harness, source);
    });
  });

  it("rejects as stale when the block changes while the render check is pending", async () => {
    const harness = await sessionWithSource();
    const { session } = harness;
    const pending = deferredCheck();
    const running = applyValidatedDiagramOperation(
      session,
      request(gantt({ kind: "setTitle", title: "Plan" })),
      pending.check,
    );
    await settle();
    expect(pending.calls).toHaveLength(1);
    await session.execute(
      editBlockContentCommand({
        sheetId: SHEET_ID,
        blockId: MERMAID.blockId,
        text: `${SOURCE}    %% typed meanwhile\n`,
      }),
    );
    pending.resolve({ ok: true });
    const outcome = await running;
    expect(!outcome.ok && outcome.error.kind).toBe("staleContent");
    expect(contentOf(harness)).toBe(`${SOURCE}    %% typed meanwhile\n`);
    await session.undo();
    expect(contentOf(harness)).toBe(SOURCE);
    expect(session.getState().history.canUndo).toBe(false);
  });
});
