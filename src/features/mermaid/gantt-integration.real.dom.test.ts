// @vitest-environment jsdom
// The gantt GUI path end to end below the UI: a Mermaid
// block's source, edited by GUI operations through the Application gate with the real render
// check, saved through the normal auto-save, reloaded from the stored file, and undone /
// redone. The stored file is compared line by line with the original, which is what a Git
// diff of the `.mmd` file would show.
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
  "    Spec :s1, 2024-01-01, 3d",
  "    Review :s2, after s1, 2d",
  "",
].join("\n");

const taskTarget = (source: string, position: number) => {
  const found = readGanttView(source)?.tasks[position];
  if (found === undefined) throw new Error("no task");
  return found.target;
};

// Operations are built one after the other because a target names the text it was made from.
const STEPS: readonly ((source: string) => GanttOperation)[] = [
  () => ({ kind: "setTitle", title: "Release plan" }),
  () => ({ kind: "addSection", name: "Build" }),
  () => ({
    kind: "addTask",
    sectionIndex: 1,
    name: "Code",
    start: { kind: "after", ids: ["s2"] },
    end: { kind: "duration", text: "5d" },
  }),
  (source) => ({
    kind: "setStatusTags",
    target: taskTarget(source, 2),
    tags: ["crit"],
  }),
  (source) => ({
    kind: "renameTask",
    target: taskTarget(source, 0),
    name: "Specification",
  }),
  (source) => ({
    kind: "setStart",
    target: taskTarget(source, 0),
    start: { kind: "date", text: "2024-01-08" },
  }),
  (source) => ({
    kind: "setTaskId",
    target: taskTarget(source, 2),
    id: "code",
  }),
];
const FINAL = [
  "gantt",
  "    title Release plan",
  "    dateFormat YYYY-MM-DD",
  "    section Design",
  "    Specification :s1, 2024-01-08, 3d",
  "    Review :s2, after s1, 2d",
  "    section Build",
  "    Code :crit, code, after s2, 5d",
  "",
].join("\n");

// Lines a text diff would report: present only in the new text, and only in the old.
function diffLines(before: string, after: string) {
  const old = before.split("\n");
  const next = after.split("\n");
  return {
    added: next.filter((line) => !old.includes(line)),
    removed: old.filter((line) => !next.includes(line)),
  };
}

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
const INTEGRATION_TIMEOUT_MS = 30_000;

describe("gantt GUI operations, save, reload, undo", {
  timeout: INTEGRATION_TIMEOUT_MS,
}, () => {
  it("edits, saves, reloads and undoes with only the touched lines changing", async () => {
    const harness = openSession([BLOCK]);
    harness.gateway.files.set(BLOCK.contentPath, ORIGINAL);
    await harness.session.loadSheetContents(SHEET_ID);
    expect(contentOf(harness)).toBe(ORIGINAL);

    for (const step of STEPS) {
      const operation = step(contentOf(harness) ?? "");
      const outcome = await runOperation(harness, operation);
      expect(outcome, JSON.stringify(operation)).toEqual({
        ok: true,
        value: { changed: true },
      });
    }
    expect(contentOf(harness)).toBe(FINAL);

    // The normal auto-save writes the block once; nothing else is written.
    harness.gateway.clearCalls();
    harness.scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await harness.session.flush();
    expect(harness.gateway.files.get(BLOCK.contentPath)).toBe(FINAL);
    expect(harness.gateway.methods()).toEqual(["writeBlockContent"]);

    // What `git diff` of the .mmd file would show: the untouched lines all survive.
    expect(diffLines(ORIGINAL, FINAL)).toEqual({
      added: [
        "    title Release plan",
        "    Specification :s1, 2024-01-08, 3d",
        "    section Build",
        "    Code :crit, code, after s2, 5d",
      ],
      removed: ["    Spec :s1, 2024-01-01, 3d"],
    });

    // Reload: a new session over the stored file reads the same, editable chart.
    const reloaded = openSession([BLOCK]);
    reloaded.gateway.files.set(
      BLOCK.contentPath,
      harness.gateway.files.get(BLOCK.contentPath) ?? "",
    );
    await reloaded.session.loadSheetContents(SHEET_ID);
    expect(contentOf(reloaded)).toBe(FINAL);
    expect(analyzeDiagramSource(FINAL).editability).toEqual({
      editable: true,
      type: "gantt",
    });

    // One undo per operation, then redo all.
    for (let step = STEPS.length; step > 0; step -= 1) {
      expect(harness.session.getState().history.canUndo).toBe(true);
      await harness.session.undo();
    }
    expect(contentOf(harness)).toBe(ORIGINAL);
    expect(harness.session.getState().history.canUndo).toBe(false);
    for (let step = 0; step < STEPS.length; step += 1) {
      await harness.session.redo();
    }
    expect(contentOf(harness)).toBe(FINAL);
    expect(harness.session.getState().history.canRedo).toBe(false);
  });

  it("leaves every untouched byte of a hand-written chart alone", async () => {
    const handWritten =
      "%% my notes\r\ngantt\r\n\tdateFormat YYYY-MM-DD\r\n\texcludes weekends\r\n\r\n\t%% keep\r\n\tOne :o1, 2024-01-01, 2d\r\n\tTwo :t2, after o1, 3d\r\n";
    const harness = openSession([BLOCK]);
    harness.gateway.files.set(BLOCK.contentPath, handWritten);
    await harness.session.loadSheetContents(SHEET_ID);
    const outcome = await runOperation(harness, {
      kind: "setDuration",
      target: taskTarget(handWritten.replaceAll("\r\n", "\n"), 1),
      duration: "4d",
    });
    expect(outcome.ok).toBe(true);
    // The command stores LF; apart from that only the duration of
    // the last task changed, and the comment, the setting and the blank line stayed.
    expect(contentOf(harness)).toBe(
      handWritten.replaceAll("\r\n", "\n").replace("3d", "4d"),
    );
  });
});
