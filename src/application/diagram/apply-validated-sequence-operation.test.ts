import { describe, expect, it } from "vitest";
import type { DiagramOperation } from "../../domain/diagram/diagram-operation";
import { SEQUENCE_MAX_SOURCE_LENGTH } from "../../domain/diagram/sequence/sequence-config";
import type { SequenceOperation } from "../../domain/diagram/sequence/sequence-operations";
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
  "sequenceDiagram\n  participant A as Alice\n  participant B as Bob\n  A->>B: Hello\n  B-->>A: Hi\n";
const HELLO = {
  index: 0,
  fingerprint:
    '{"kind":"message","from":"A","to":"B","arrow":"->>","text":"Hello","activates":false}',
};

const seq = (operation: SequenceOperation): DiagramOperation => ({
  diagram: "sequence",
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

describe("applyValidatedDiagramOperation with a sequence diagram", () => {
  it("commits one undo entry after the render check, and redo restores it", async () => {
    const harness = await sessionWithSource();
    const { session } = harness;
    const seen: string[] = [];
    const outcome = await applyValidatedDiagramOperation(
      session,
      request(
        seq({
          kind: "addMessage",
          from: "B",
          to: "A",
          arrow: "-->>",
          text: "Later",
        }),
      ),
      async (candidate) => {
        seen.push(candidate);
        expect(contentOf(harness)).toBe(SOURCE);
        return { ok: true };
      },
    );
    expect(outcome).toEqual({ ok: true, value: { changed: true } });
    const expected = `${SOURCE}  B-->>A: Later\n`;
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
      request(seq({ kind: "setTitle", title: "Greeting" })),
      accept,
    );
    expect(harness.gateway.calls).toEqual([]);
    harness.scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await settle();
    expect(harness.gateway.methods()).toEqual(["writeBlockContent"]);
    expect(contentOf(harness)).toBe(
      SOURCE.replace(
        "sequenceDiagram\n",
        "sequenceDiagram\n  title Greeting\n",
      ),
    );
  });

  it("applies an operation made of several edits as one history entry", async () => {
    const source = "sequenceDiagram\n  A->>B: one\n  C->>D: two\n";
    const harness = await sessionWithSource(source);
    const outcome = await applyValidatedDiagramOperation(
      harness.session,
      request(
        seq({
          kind: "moveMessage",
          target: {
            index: 0,
            fingerprint:
              '{"kind":"message","from":"A","to":"B","arrow":"->>","text":"one","activates":false}',
          },
          direction: "down",
        }),
      ),
      accept,
    );
    expect(outcome.ok).toBe(true);
    expect(contentOf(harness)).toBe(
      "sequenceDiagram\n  participant A\n  participant B\n  participant C\n  participant D\n  C->>D: two\n  A->>B: one\n",
    );
    await harness.session.undo();
    expect(contentOf(harness)).toBe(source);
    expect(harness.session.getState().history.canUndo).toBe(false);
  });

  it("skips the render check and history for a no-op", async () => {
    const harness = await sessionWithSource();
    const { check, calls } = deferredCheck();
    const outcome = await applyValidatedDiagramOperation(
      harness.session,
      request(seq({ kind: "setAutonumber", enabled: false })),
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
      "sequenceDiagram\r\n  A->>B: x\r\n",
    );
    await harness.session.loadSheetContents(SHEET_ID);
    const seen: string[] = [];
    const outcome = await applyValidatedDiagramOperation(
      harness.session,
      request(seq({ kind: "setAutonumber", enabled: true })),
      async (candidate) => {
        seen.push(candidate);
        return { ok: true };
      },
    );
    expect(outcome.ok).toBe(true);
    expect(seen).toEqual(["sequenceDiagram\n  autonumber\n  A->>B: x\n"]);
  });

  describe("refusals leave content, history and save state unchanged", () => {
    it("render check failure -> diagramRenderRejected", async () => {
      const harness = await sessionWithSource();
      const outcome = await applyValidatedDiagramOperation(
        harness.session,
        request(
          seq({ kind: "editMessageText", target: HELLO, text: "Hi there" }),
        ),
        async () => ({ ok: false, message: "Parse error on line 2" }),
      );
      expect(!outcome.ok && outcome.error.kind).toBe("diagramRenderRejected");
      expect(!outcome.ok && outcome.error.detail).toContain(
        "Parse error on line 2",
      );
      expectUntouched(harness, SOURCE);
    });

    it.each<[string, SequenceOperation]>([
      [
        "a text with a directive",
        { kind: "editMessageText", target: HELLO, text: "%%{init: {}}%%" },
      ],
      [
        "a participant that does not exist",
        { kind: "addMessage", from: "A", to: "Z", arrow: "->>", text: "x" },
      ],
      [
        "a stale target",
        {
          kind: "editMessageText",
          target: { index: 0, fingerprint: "old" },
          text: "x",
        },
      ],
      [
        "a duplicate participant id",
        {
          kind: "addParticipant",
          participantKind: "participant",
          label: "x",
          id: "A",
        },
      ],
    ])(
      "domain refusal (%s) -> invalidDiagramOperation, no render",
      async (_name, operation) => {
        const harness = await sessionWithSource();
        const { check, calls } = deferredCheck();
        const outcome = await applyValidatedDiagramOperation(
          harness.session,
          request(seq(operation)),
          check,
        );
        expect(!outcome.ok && outcome.error.kind).toBe(
          "invalidDiagramOperation",
        );
        expect(calls).toEqual([]);
        expectUntouched(harness, SOURCE);
      },
    );

    it("a diagram that is not editable -> diagramNotEditable", async () => {
      const source = "sequenceDiagram\n  A->>()B: x\n";
      const harness = await sessionWithSource(source);
      const { check, calls } = deferredCheck();
      const outcome = await applyValidatedDiagramOperation(
        harness.session,
        request(seq({ kind: "setTitle", title: "x" })),
        check,
      );
      expect(!outcome.ok && outcome.error.kind).toBe("diagramNotEditable");
      expect(calls).toEqual([]);
      expectUntouched(harness, source);
    });

    it("an operation that would push the text over the length limit is refused", async () => {
      const padding = `  %% ${"x".repeat(SEQUENCE_MAX_SOURCE_LENGTH - 60)}\n`;
      const source = `sequenceDiagram\n  A->>B: x\n${padding}`;
      expect(source.length).toBeLessThanOrEqual(SEQUENCE_MAX_SOURCE_LENGTH);
      const harness = await sessionWithSource(source);
      const { check, calls } = deferredCheck();
      const outcome = await applyValidatedDiagramOperation(
        harness.session,
        request(
          seq({
            kind: "addMessage",
            from: "A",
            to: "B",
            arrow: "->>",
            text: "y".repeat(200),
          }),
        ),
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
      request(seq({ kind: "setAutonumber", enabled: true })),
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
