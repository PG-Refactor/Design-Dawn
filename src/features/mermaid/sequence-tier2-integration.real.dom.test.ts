// @vitest-environment jsdom
// The Tier 2 sequence operations end to end below the UI (docs/architecture.md §16.16.9): a
// Mermaid block's source, edited through the Application gate with the real render check,
// saved through the normal auto-save, reloaded from the stored file, and undone / redone, one
// undo per operation.
import { beforeAll, describe, expect, it } from "vitest";
import { applyValidatedDiagramOperation } from "../../application/diagram/apply-validated-diagram-operation";
import {
  DOCUMENT_ID,
  makeBlockAt,
  SHEET_ID,
} from "../../application/test-support/fakes";
import {
  openSession,
  TEST_AUTO_SAVE_DELAY_MS,
} from "../../application/test-support/session-harness";
import { analyzeDiagramSource } from "../../domain/diagram/diagram-source";
import type { SequenceOperation } from "../../domain/diagram/sequence/sequence-operations";
import { readSequenceView } from "../../domain/diagram/sequence/sequence-view";
import { createDiagramRenderCheck } from "./diagram-render-check";
import { mermaidRenderer } from "./render-mermaid";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";

beforeAll(installFakeSvgMeasurement);

const renderCheck = createDiagramRenderCheck(mermaidRenderer);
const BLOCK = makeBlockAt(1, 0, 0, "mermaid");
const ORIGINAL = [
  "sequenceDiagram",
  "  participant A as Alice",
  "  participant B as Bob",
  "  A->>B: Hello",
  "  B-->>A: Hi",
  "",
].join("\n");

const view = (source: string) => {
  const result = readSequenceView(source);
  if (result === null) throw new Error("not editable");
  return result;
};
const branch = (source: string, text: string) => {
  const entry = view(source).entries.find(
    (candidate) =>
      candidate.kind === "branch" && candidate.displayText === text,
  );
  if (entry === undefined) throw new Error(`no branch ${text}`);
  return entry.target;
};
const message = (source: string, text: string) => {
  const entry = view(source).entries.find(
    (candidate) =>
      candidate.kind === "message" && candidate.displayText === text,
  );
  if (entry === undefined) throw new Error(`no message ${text}`);
  return entry.target;
};
const header = (source: string, text: string) => {
  const entry = view(source).entries.find(
    (candidate) =>
      candidate.kind === "blockStart" && candidate.displayText === text,
  );
  if (entry === undefined) throw new Error(`no block ${text}`);
  return entry.target;
};

// Operations are built one after the other because a target names the text it was made from.
const STEPS: readonly ((source: string) => SequenceOperation)[] = [
  () => ({
    kind: "addParticipant",
    participantKind: "participant",
    label: "Carol",
    id: "C",
  }),
  (source) => ({
    kind: "addMessage",
    from: "B",
    to: "C",
    arrow: "->>",
    text: "forward",
    after: message(source, "Hi"),
  }),
  (source) => ({
    kind: "wrapInBlock",
    from: message(source, "Hello"),
    to: message(source, "Hi"),
    block: "alt",
    text: "ok",
  }),
  (source) => ({
    kind: "addBranch",
    target: header(source, "ok"),
    text: "fail",
  }),
  (source) => ({
    kind: "setMessageActivation",
    target: message(source, "Hello"),
    sign: "+",
  }),
  (source) => ({
    kind: "setMessageActivation",
    target: message(source, "Hi"),
    sign: "-",
  }),
  (source) => ({
    kind: "duplicateMessage",
    target: message(source, "Hi"),
  }),
  () => ({
    kind: "reorderParticipants",
    participantId: "B",
    direction: "left",
  }),
  () => ({ kind: "deleteParticipant", participantId: "C" }),
  (source) => ({
    kind: "deleteBranch",
    target: branch(source, "fail"),
  }),
  (source) => ({
    kind: "unwrapBlock",
    target: header(source, "ok"),
  }),
];

type Harness = ReturnType<typeof openSession>;
const contentOf = (harness: Harness) =>
  harness.session.getState().contents.get(BLOCK.blockId);

async function runOperation(harness: Harness, operation: SequenceOperation) {
  return applyValidatedDiagramOperation(
    harness.session,
    {
      documentId: DOCUMENT_ID,
      sheetId: SHEET_ID,
      blockId: BLOCK.blockId,
      operation: { diagram: "sequence", operation },
    },
    renderCheck,
  );
}

describe("sequence Tier 2 operations, save, reload, undo", () => {
  it("edits, saves, reloads and undoes one operation at a time", async () => {
    const harness = openSession([BLOCK]);
    harness.gateway.files.set(BLOCK.contentPath, ORIGINAL);
    await harness.session.loadSheetContents(SHEET_ID);

    const states = [ORIGINAL];
    for (const step of STEPS) {
      const operation = step(contentOf(harness) ?? "");
      const outcome = await runOperation(harness, operation);
      expect(outcome, JSON.stringify(operation)).toEqual({
        ok: true,
        value: { changed: true },
      });
      states.push(contentOf(harness) ?? "");
    }
    const final = states[states.length - 1] ?? "";
    expect(final).toBe(
      [
        "sequenceDiagram",
        "  participant B as Bob",
        "  participant A as Alice",
        "  A->>+B: Hello",
        "  B-->>-A: Hi",
        "  B-->>A: Hi",
        "",
      ].join("\n"),
    );
    expect(states).toHaveLength(STEPS.length + 1);

    harness.gateway.clearCalls();
    harness.scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await harness.session.flush();
    expect(harness.gateway.files.get(BLOCK.contentPath)).toBe(final);
    expect(harness.gateway.methods()).toEqual(["writeBlockContent"]);

    const reloaded = openSession([BLOCK]);
    reloaded.gateway.files.set(
      BLOCK.contentPath,
      harness.gateway.files.get(BLOCK.contentPath) ?? "",
    );
    await reloaded.session.loadSheetContents(SHEET_ID);
    expect(contentOf(reloaded)).toBe(final);
    expect(analyzeDiagramSource(final).editability).toEqual({
      editable: true,
      type: "sequence",
    });

    // One undo per operation walks back through every state; redo walks forward again.
    for (let step = STEPS.length; step > 0; step -= 1) {
      await harness.session.undo();
      expect(contentOf(harness)).toBe(states[step - 1]);
    }
    expect(harness.session.getState().history.canUndo).toBe(false);
    for (let step = 1; step <= STEPS.length; step += 1) {
      await harness.session.redo();
      expect(contentOf(harness)).toBe(states[step]);
    }
    expect(harness.session.getState().history.canRedo).toBe(false);
  });
});
