// @vitest-environment jsdom
// A few sequence operations run through the whole Application gate
// (`applyValidatedDiagramOperation`) with the REAL render check (mermaid 12.1.0): the
// candidate is read, drawn and sanitised, then committed as one undo entry
// (docs/architecture.md §16.16.7). The proof of the plans themselves is
// sequence-operations.real.dom.test.ts.
import { beforeAll, describe, expect, it } from "vitest";
import { editBlockContentCommand } from "../../application/commands/content-commands";
import { applyValidatedDiagramOperation } from "../../application/diagram/apply-validated-diagram-operation";
import {
  DOCUMENT_ID,
  makeBlockAt,
  SHEET_ID,
} from "../../application/test-support/fakes";
import { openSession } from "../../application/test-support/session-harness";
import type { DiagramOperation } from "../../domain/diagram/diagram-operation";
import type { SequenceOperation } from "../../domain/diagram/sequence/sequence-operations";
import { createDiagramRenderCheck } from "./diagram-render-check";
import { mermaidRenderer } from "./render-mermaid";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";

beforeAll(installFakeSvgMeasurement);

const renderCheck = createDiagramRenderCheck(mermaidRenderer);
const BLOCK = makeBlockAt(1, 0, 0, "mermaid");
const SOURCE =
  "sequenceDiagram\n  %% keep me\n  participant A as Alice\n  A->>+B: call\n  B-->>-A: back\n  Note over A,B: done\n";
const MESSAGE_CALL = {
  index: 0,
  fingerprint:
    '{"kind":"message","from":"A","to":"B","arrow":"->>","text":"call","activates":true}',
};
const NOTE_DONE = {
  index: 4,
  fingerprint:
    '{"kind":"note","placement":"over","participants":["A","B"],"text":"done"}',
};
const seq = (operation: SequenceOperation): DiagramOperation => ({
  diagram: "sequence",
  operation,
});

async function open(source: string) {
  const harness = openSession([BLOCK]);
  await harness.session.loadSheetContents(SHEET_ID);
  await harness.session.execute(
    editBlockContentCommand({
      sheetId: SHEET_ID,
      blockId: BLOCK.blockId,
      text: source,
    }),
  );
  harness.session.clearHistory();
  return harness;
}
const run = (
  harness: Awaited<ReturnType<typeof open>>,
  operation: SequenceOperation,
) =>
  applyValidatedDiagramOperation(
    harness.session,
    {
      documentId: DOCUMENT_ID,
      sheetId: SHEET_ID,
      blockId: BLOCK.blockId,
      operation: seq(operation),
    },
    renderCheck,
  );
const contentOf = (harness: Awaited<ReturnType<typeof open>>) =>
  harness.session.getState().contents.get(BLOCK.blockId);

describe("sequence operations through the real render check", () => {
  it.each<[string, SequenceOperation, string]>([
    [
      "setTitle",
      { kind: "setTitle", title: "Call; back" },
      SOURCE.replace(
        "sequenceDiagram\n",
        "sequenceDiagram\n  title Call#59; back\n",
      ),
    ],
    [
      "renameParticipantLabel (implicit participant)",
      { kind: "renameParticipantLabel", participantId: "B", label: "Bob" },
      SOURCE.replace(
        "  A->>+B: call",
        "  participant B as Bob\n  A->>+B: call",
      ),
    ],
    [
      "editMessageText",
      { kind: "editMessageText", target: MESSAGE_CALL, text: "call now" },
      SOURCE.replace("call", "call now"),
    ],
    [
      "changeArrow",
      { kind: "changeArrow", target: MESSAGE_CALL, arrow: "-->>" },
      SOURCE.replace("A->>+B", "A-->>+B"),
    ],
    [
      "addMessage",
      { kind: "addMessage", from: "B", to: "A", arrow: "->", text: "ok" },
      `${SOURCE}  B->A: ok\n`,
    ],
    [
      "changeNotePlacement",
      { kind: "changeNotePlacement", target: NOTE_DONE, placement: "rightOf" },
      SOURCE.replace("over A,B", "right of A"),
    ],
    [
      "deleteNote",
      { kind: "deleteNote", target: NOTE_DONE },
      SOURCE.replace("  Note over A,B: done\n", ""),
    ],
  ])("%s commits one undo entry", async (_name, operation, expected) => {
    const harness = await open(SOURCE);
    const outcome = await run(harness, operation);
    expect(outcome).toEqual({ ok: true, value: { changed: true } });
    expect(contentOf(harness)).toBe(expected);
    await harness.session.undo();
    expect(contentOf(harness)).toBe(SOURCE);
    expect(harness.session.getState().history.canUndo).toBe(false);
    await harness.session.redo();
    expect(contentOf(harness)).toBe(expected);
  });

  it("refuses an operation on a diagram Mermaid cannot draw, leaving the block", async () => {
    // `activate Z` parses, but Z never appears, so Mermaid cannot draw it.
    const source = "sequenceDiagram\n  activate Z\n  A->>B: x\n";
    const harness = await open(source);
    const outcome = await run(harness, { kind: "setTitle", title: "x" });
    expect(outcome.ok).toBe(false);
    expect(contentOf(harness)).toBe(source);
    expect(harness.session.getState().history.canUndo).toBe(false);
  });
});
