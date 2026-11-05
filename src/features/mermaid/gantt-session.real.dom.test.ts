// @vitest-environment jsdom
// A few gantt operations run through the whole Application gate
// (`applyValidatedDiagramOperation`) with the REAL render check (mermaid 12.3.0): the
// candidate is read, drawn and sanitised, then committed as one undo entry.
// The proof of the plans themselves is
// gantt-operations.real.dom.test.ts.
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
import type { GanttOperation } from "../../domain/diagram/gantt/gantt-operations";
import { createDiagramRenderCheck } from "./diagram-render-check";
import { mermaidRenderer } from "./render-mermaid";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";

beforeAll(installFakeSvgMeasurement);

const renderCheck = createDiagramRenderCheck(mermaidRenderer);
const BLOCK = makeBlockAt(1, 0, 0, "mermaid");
const SOURCE =
  "gantt\n    %% keep me\n    dateFormat YYYY-MM-DD\n    section Design\n    Spec :done, s1, 2024-01-01, 3d\n    Review :s2, after s1, 2d\n    section Build\n    Code :b1, after s2, 5d\n";
const SPEC = { index: 0, name: "Spec" };
const REVIEW = { index: 1, name: "Review" };
const CODE = { index: 2, name: "Code" };
const gantt = (operation: GanttOperation): DiagramOperation => ({
  diagram: "gantt",
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
type Harness = Awaited<ReturnType<typeof open>>;
const run = (harness: Harness, operation: GanttOperation) =>
  applyValidatedDiagramOperation(
    harness.session,
    {
      documentId: DOCUMENT_ID,
      sheetId: SHEET_ID,
      blockId: BLOCK.blockId,
      operation: gantt(operation),
    },
    renderCheck,
  );
const contentOf = (harness: Harness) =>
  harness.session.getState().contents.get(BLOCK.blockId);

describe("gantt operations through the real render check", () => {
  it.each<[string, GanttOperation, string]>([
    [
      "setTitle",
      { kind: "setTitle", title: "Release" },
      SOURCE.replace("gantt\n", "gantt\n    title Release\n"),
    ],
    [
      "renameTask",
      { kind: "renameTask", target: REVIEW, name: "Peer review" },
      SOURCE.replace("Review", "Peer review"),
    ],
    [
      "setDuration",
      { kind: "setDuration", target: SPEC, duration: "4d" },
      SOURCE.replace("3d", "4d"),
    ],
    [
      "setStart",
      {
        kind: "setStart",
        target: SPEC,
        start: { kind: "date", text: "2024-02-05" },
      },
      SOURCE.replace("2024-01-01", "2024-02-05"),
    ],
    [
      "setStatusTags",
      { kind: "setStatusTags", target: CODE, tags: ["crit", "active"] },
      SOURCE.replace("Code :b1", "Code :active, crit, b1"),
    ],
    [
      "renameSection",
      {
        kind: "renameSection",
        target: { index: 1, name: "Build" },
        name: "Make",
      },
      SOURCE.replace("section Build", "section Make"),
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

  it("refuses an operation on a chart Mermaid cannot draw, leaving the block", async () => {
    // Every day excluded: Mermaid cannot place a task, so the editor refuses the chart.
    const source =
      "gantt\n    dateFormat YYYY-MM-DD\n    excludes monday, tuesday, wednesday, thursday, friday, saturday, sunday\n    A :a1, 2024-01-01, 1d\n";
    const harness = await open(source);
    const outcome = await run(harness, { kind: "setTitle", title: "x" });
    expect(outcome.ok).toBe(false);
    expect(contentOf(harness)).toBe(source);
    expect(harness.session.getState().history.canUndo).toBe(false);
  });
});
