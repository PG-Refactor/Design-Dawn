// @vitest-environment jsdom
// A few flowchart operations run through the whole Application gate
// (`applyValidatedDiagramOperation`) with the REAL render check (mermaid 12.1.0): the
// candidate is read, drawn and sanitised, then committed as one undo entry.
// The 1,106-operation proof of the plans themselves is
// flowchart-operations.real.dom.test.ts.
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
import type { FlowchartOperation } from "../../domain/diagram/flowchart/flowchart-operations";
import { createDiagramRenderCheck } from "./diagram-render-check";
import { mermaidRenderer } from "./render-mermaid";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";

beforeAll(installFakeSvgMeasurement);

const renderCheck = createDiagramRenderCheck(mermaidRenderer);
const BLOCK = makeBlockAt(1, 0, 0, "mermaid");
const SOURCE =
  'flowchart LR\n  %% keep me\n  A["Start"] --> B(End)\n  B -.-> C{Choice}\n';
const flow = (operation: FlowchartOperation): DiagramOperation => ({
  diagram: "flowchart",
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
  operation: FlowchartOperation,
) =>
  applyValidatedDiagramOperation(
    harness.session,
    {
      documentId: DOCUMENT_ID,
      sheetId: SHEET_ID,
      blockId: BLOCK.blockId,
      operation: flow(operation),
    },
    renderCheck,
  );
const contentOf = (harness: Awaited<ReturnType<typeof open>>) =>
  harness.session.getState().contents.get(BLOCK.blockId);

describe("flowchart operations through the real render check", () => {
  it.each<[string, FlowchartOperation, string]>([
    [
      "setDirection",
      { kind: "setDirection", direction: "TB" },
      SOURCE.replace("LR", "TD"),
    ],
    [
      "setNodeLabel",
      { kind: "setNodeLabel", nodeId: "B", label: "Finish <1>" },
      SOURCE.replace("B(End)", 'B("Finish #lt;1#gt;")'),
    ],
    [
      "setNodeShape",
      { kind: "setNodeShape", nodeId: "A", shape: "circle" },
      SOURCE.replace('A["Start"]', 'A(("Start"))'),
    ],
    [
      "addNode",
      { kind: "addNode", label: "Extra" },
      `${SOURCE}  N1["Extra"]\n`,
    ],
    [
      "addEdge",
      { kind: "addEdge", from: "C", to: "A", label: "again" },
      `${SOURCE}  C -->|"again"| A\n`,
    ],
    [
      "setEdgeLabel",
      {
        kind: "setEdgeLabel",
        target: { index: 1, id: "L_B_C_0" },
        label: "maybe",
      },
      SOURCE.replace("B -.-> C", 'B -.->|"maybe"| C'),
    ],
    [
      "deleteEdge",
      { kind: "deleteEdge", target: { index: 1, id: "L_B_C_0" } },
      'flowchart LR\n  %% keep me\n  A["Start"] --> B(End)\n  C{Choice}\n',
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

  it("refuses an operation on a flowchart Mermaid cannot draw, leaving the block", async () => {
    // An ellipse shape is read but Mermaid cannot draw it, so the diagram is not editable.
    const source = 'flowchart LR\n  A(-"x"-) --> B\n';
    const harness = await open(source);
    const outcome = await run(harness, {
      kind: "setDirection",
      direction: "TB",
    });
    expect(outcome.ok).toBe(false);
    expect(contentOf(harness)).toBe(source);
    expect(harness.session.getState().history.canUndo).toBe(false);
  });
});
