import { describe, expect, it } from "vitest";
import type { DiagramOperation } from "../../domain/diagram/diagram-operation";
import {
  FLOWCHART_MAX_EDGES,
  FLOWCHART_MAX_SOURCE_LENGTH,
} from "../../domain/diagram/flowchart/flowchart-config";
import type { FlowchartOperation } from "../../domain/diagram/flowchart/flowchart-operations";
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
const SOURCE = "flowchart LR\n  A[Start] --> B[End]\n";
const EDGE_A_B = { index: 0, id: "L_A_B_0" };

const flow = (operation: FlowchartOperation): DiagramOperation => ({
  diagram: "flowchart",
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

describe("applyValidatedDiagramOperation with a flowchart", () => {
  it("commits one undo entry after the render check, and redo restores it", async () => {
    const harness = await sessionWithSource();
    const { session } = harness;
    const seen: string[] = [];
    const outcome = await applyValidatedDiagramOperation(
      session,
      request(flow({ kind: "addEdge", from: "B", to: "A", label: "back" })),
      async (candidate) => {
        seen.push(candidate);
        expect(contentOf(harness)).toBe(SOURCE);
        return { ok: true };
      },
    );
    expect(outcome).toEqual({ ok: true, value: { changed: true } });
    const expected = `${SOURCE}  B -->|"back"| A\n`;
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
      request(flow({ kind: "setDirection", direction: "TB" })),
      accept,
    );
    expect(harness.gateway.calls).toEqual([]);
    harness.scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();
    expect(harness.gateway.methods()).toEqual(["writeBlockContent"]);
    expect(contentOf(harness)).toBe("flowchart TD\n  A[Start] --> B[End]\n");
  });

  it("applies an operation made of several edits as one history entry", async () => {
    const source = "flowchart LR\n  A --> B\n  B --> C\n";
    const harness = await sessionWithSource(source);
    const outcome = await applyValidatedDiagramOperation(
      harness.session,
      request(
        flow({ kind: "deleteEdge", target: { index: 0, id: "L_A_B_0" } }),
      ),
      accept,
    );
    expect(outcome.ok).toBe(true);
    await harness.session.undo();
    expect(contentOf(harness)).toBe(source);
    expect(harness.session.getState().history.canUndo).toBe(false);
  });

  it("skips the render check and history for a no-op", async () => {
    const harness = await sessionWithSource();
    const { check, calls } = deferredCheck();
    const outcome = await applyValidatedDiagramOperation(
      harness.session,
      request(flow({ kind: "setDirection", direction: "LR" })),
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
      "flowchart LR\r\n  A --> B\r\n",
    );
    await harness.session.loadSheetContents(SHEET_ID);
    const seen: string[] = [];
    const outcome = await applyValidatedDiagramOperation(
      harness.session,
      request(flow({ kind: "setDirection", direction: "TB" })),
      async (candidate) => {
        seen.push(candidate);
        return { ok: true };
      },
    );
    expect(outcome.ok).toBe(true);
    expect(seen).toEqual(["flowchart TD\n  A --> B\n"]);
  });

  describe("refusals leave content, history and save state unchanged", () => {
    it("render check failure -> diagramRenderRejected", async () => {
      const harness = await sessionWithSource();
      const outcome = await applyValidatedDiagramOperation(
        harness.session,
        request(flow({ kind: "setNodeLabel", nodeId: "A", label: "Go" })),
        async () => ({ ok: false, message: "Parse error on line 2" }),
      );
      expect(!outcome.ok && outcome.error.kind).toBe("diagramRenderRejected");
      expect(!outcome.ok && outcome.error.detail).toContain(
        "Parse error on line 2",
      );
      expectUntouched(harness, SOURCE);
    });

    it.each<[string, FlowchartOperation]>([
      [
        "a label with a double quote",
        { kind: "setNodeLabel", nodeId: "A", label: 'say "x"' },
      ],
      ["an unknown node", { kind: "setNodeLabel", nodeId: "Z", label: "z" }],
      [
        "an edge whose id does not match",
        { kind: "deleteEdge", target: { index: 0, id: "L_X_Y_0" } },
      ],
      ["a duplicate node id", { kind: "addNode", label: "x", id: "A" }],
    ])(
      "domain refusal (%s) -> invalidDiagramOperation, no render",
      async (_name, operation) => {
        const harness = await sessionWithSource();
        const { check, calls } = deferredCheck();
        const outcome = await applyValidatedDiagramOperation(
          harness.session,
          request(flow(operation)),
          check,
        );
        expect(!outcome.ok && outcome.error.kind).toBe(
          "invalidDiagramOperation",
        );
        expect(calls).toEqual([]);
        expectUntouched(harness, SOURCE);
      },
    );

    it("a flowchart that is not editable -> diagramNotEditable", async () => {
      const source = "flowchart LR\n  A --> B\n  ???\n";
      const harness = await sessionWithSource(source);
      const { check, calls } = deferredCheck();
      const outcome = await applyValidatedDiagramOperation(
        harness.session,
        request(flow({ kind: "setDirection", direction: "TB" })),
        check,
      );
      expect(!outcome.ok && outcome.error.kind).toBe("diagramNotEditable");
      expect(calls).toEqual([]);
      expectUntouched(harness, source);
    });

    it("the 501st edge is refused (tooManyEdges) before any render", async () => {
      const lines = Array.from(
        { length: FLOWCHART_MAX_EDGES },
        () => "  A --> B\n",
      );
      const source = `flowchart LR\n${lines.join("")}`;
      const harness = await sessionWithSource(source);
      const { check, calls } = deferredCheck();
      const outcome = await applyValidatedDiagramOperation(
        harness.session,
        request(flow({ kind: "addEdge", from: "A", to: "B" })),
        check,
      );
      expect(!outcome.ok && outcome.error.kind).toBe("invalidDiagramOperation");
      expect(!outcome.ok && outcome.error.detail).toContain("tooManyEdges");
      expect(calls).toEqual([]);
      expectUntouched(harness, source);
    });

    it("an operation that would push the text over the length limit is refused", async () => {
      const padding = `  %% ${"x".repeat(FLOWCHART_MAX_SOURCE_LENGTH - 60)}\n`;
      const source = `flowchart LR\n  A --> B\n${padding}`;
      expect(source.length).toBeLessThanOrEqual(FLOWCHART_MAX_SOURCE_LENGTH);
      const harness = await sessionWithSource(source);
      const { check, calls } = deferredCheck();
      const outcome = await applyValidatedDiagramOperation(
        harness.session,
        request(flow({ kind: "addNode", label: "y".repeat(200), id: "Long" })),
        check,
      );
      expect(outcome.ok).toBe(false);
      expect(calls).toEqual([]);
      expectUntouched(harness, source);
    });

    it("a node id that equals a subgraph id (phantom node) is refused", async () => {
      const source = "flowchart LR\n  subgraph S\n    A\n  end\n";
      const harness = await sessionWithSource(source);
      const outcome = await applyValidatedDiagramOperation(
        harness.session,
        request(flow({ kind: "addNode", label: "x", id: "S" })),
        accept,
      );
      expect(!outcome.ok && outcome.error.kind).toBe("invalidDiagramOperation");
      expectUntouched(harness, source);
    });

    it("a label that would introduce a directive is refused", async () => {
      const harness = await sessionWithSource();
      const outcome = await applyValidatedDiagramOperation(
        harness.session,
        request(
          flow({ kind: "setNodeLabel", nodeId: "A", label: "%%{init: {}}%%" }),
        ),
        accept,
      );
      expect(!outcome.ok && outcome.error.kind).toBe("invalidDiagramOperation");
      expectUntouched(harness, SOURCE);
    });

    it("an edge target taken from an older text is refused", async () => {
      const harness = await sessionWithSource();
      const outcome = await applyValidatedDiagramOperation(
        harness.session,
        request(flow({ kind: "setEdgeLabel", target: EDGE_A_B, label: "ok" })),
        accept,
      );
      expect(outcome.ok).toBe(true);
      // The same target after the edit still names the edge, but index 5 does not exist.
      const stale = await applyValidatedDiagramOperation(
        harness.session,
        request(
          flow({
            kind: "setEdgeLabel",
            target: { index: 5, id: "L_A_B_0" },
            label: "no",
          }),
        ),
        accept,
      );
      expect(!stale.ok && stale.error.kind).toBe("invalidDiagramOperation");
    });
  });

  it("rejects as stale when the block changes while the render check is pending", async () => {
    const harness = await sessionWithSource();
    const { session } = harness;
    const pending = deferredCheck();
    const running = applyValidatedDiagramOperation(
      session,
      request(flow({ kind: "setDirection", direction: "TB" })),
      pending.check,
    );
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
    expect(contentOf(harness)).toBe(`${SOURCE}  %% typed meanwhile\n`);
    await session.undo();
    expect(contentOf(harness)).toBe(SOURCE);
    expect(session.getState().history.canUndo).toBe(false);
  });
});
