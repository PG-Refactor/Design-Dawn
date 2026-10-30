// @vitest-environment jsdom
// The Tier 2 gantt operations end to end below the UI: edited
// through the Application gate with the real render check, saved through the normal
// auto-save, reloaded from the stored file, and undone / redone, one undo step per operation.
// The stored text is compared with what a Git diff of the `.mmd` file would show.
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
import type { GanttOperation } from "../../domain/diagram/gantt/gantt-operations";
import { readGanttView } from "../../domain/diagram/gantt/gantt-view";
import { createDiagramRenderCheck } from "./diagram-render-check";
import { mermaidRenderer } from "./render-mermaid";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";

beforeAll(installFakeSvgMeasurement);

const renderCheck = createDiagramRenderCheck(mermaidRenderer);
const BLOCK = makeBlockAt(1, 0, 0, "mermaid");
const ORIGINAL = [
  "gantt",
  "    dateFormat YYYY-MM-DD",
  "    section Design",
  "    Spec :s1, 2024-01-05, 3d",
  "    Review :2d",
  "    section Build",
  "    Code :c1, 2024-02-01, 5d",
  "",
].join("\n");

const taskTarget = (source: string, position: number) => {
  const found = readGanttView(source)?.tasks[position];
  if (found === undefined) throw new Error("no task");
  return found.target;
};
const sectionTarget = (source: string, position: number) => {
  const found = readGanttView(source)?.sections[position];
  if (found === undefined) throw new Error("no section");
  return found.target;
};

// Built one after the other because a target names the text it was made from.
const STEPS: readonly ((source: string) => GanttOperation)[] = [
  () => ({ kind: "setExcludes", tokens: ["weekends"] }),
  () => ({ kind: "setAxisFormat", format: "%m/%d" }),
  // Review follows Spec: swapping them writes Review's start as the date it has (with the
  // weekend excluded Spec ends on the 10th).
  (source) => ({
    kind: "moveTask",
    target: taskTarget(source, 0),
    direction: "down",
  }),
  (source) => ({
    kind: "moveTaskToSection",
    target: taskTarget(source, 1),
    sectionIndex: 1,
  }),
  (source) => ({ kind: "duplicateTask", target: taskTarget(source, 2) }),
  (source) => ({
    kind: "addLink",
    target: taskTarget(source, 2),
    url: "https://example.com/code",
  }),
  (source) => ({
    kind: "moveSection",
    target: sectionTarget(source, 1),
    direction: "up",
  }),
];

type Harness = ReturnType<typeof openSession>;
const contentOf = (harness: Harness) =>
  harness.session.getState().contents.get(BLOCK.blockId);

async function runOperation(harness: Harness, operation: GanttOperation) {
  return applyValidatedDiagramOperation(
    harness.session,
    {
      documentId: DOCUMENT_ID,
      sheetId: SHEET_ID,
      blockId: BLOCK.blockId,
      operation: { diagram: "gantt", operation },
    },
    renderCheck,
  );
}

// Each test runs several real Mermaid renders plus save / reload / undo; under a full
// parallel test run that can exceed the 5 s default, so the budget is explicit.
const INTEGRATION_TIMEOUT_MS = 60_000;

describe("gantt Tier 2 operations, save, reload, undo", {
  timeout: INTEGRATION_TIMEOUT_MS,
}, () => {
  it("edits, saves, reloads and undoes with one undo step per operation", async () => {
    const harness = openSession([BLOCK]);
    harness.gateway.files.set(BLOCK.contentPath, ORIGINAL);
    await harness.session.loadSheetContents(SHEET_ID);

    const texts = [ORIGINAL];
    for (const step of STEPS) {
      const operation = step(contentOf(harness) ?? "");
      const outcome = await runOperation(harness, operation);
      expect(outcome, JSON.stringify(operation)).toEqual({
        ok: true,
        value: { changed: true },
      });
      texts.push(contentOf(harness) ?? "");
    }
    const final = texts[texts.length - 1] as string;
    expect(final).toBe(
      [
        "gantt",
        "    dateFormat YYYY-MM-DD",
        "    axisFormat %m/%d",
        "    excludes weekends",
        "    section Build",
        "    Code :c1, 2024-02-01, 5d",
        "    Spec :s1, 2024-01-05, 3d",
        '    click s1 href "https://example.com/code"',
        "    Spec :gt1, 2024-01-05, 3d",
        "    section Design",
        "    Review :2024-01-10, 2d",
        "",
      ].join("\n"),
    );

    // The normal auto-save writes the block once; nothing else is written.
    harness.gateway.clearCalls();
    harness.scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await harness.session.flush();
    expect(harness.gateway.files.get(BLOCK.contentPath)).toBe(final);
    expect(harness.gateway.methods()).toEqual(["writeBlockContent"]);

    // Reload: a new session over the stored file reads the same, editable chart.
    const reloaded = openSession([BLOCK]);
    reloaded.gateway.files.set(BLOCK.contentPath, final);
    await reloaded.session.loadSheetContents(SHEET_ID);
    expect(contentOf(reloaded)).toBe(final);
    expect(analyzeDiagramSource(final).editability).toEqual({
      editable: true,
      type: "gantt",
    });

    // One undo per operation walks back through every intermediate text, then redo.
    for (let step = STEPS.length - 1; step >= 0; step -= 1) {
      await harness.session.undo();
      expect(contentOf(harness)).toBe(texts[step]);
    }
    expect(harness.session.getState().history.canUndo).toBe(false);
    for (let step = 0; step < STEPS.length; step += 1) {
      await harness.session.redo();
    }
    expect(contentOf(harness)).toBe(final);
  });
});
