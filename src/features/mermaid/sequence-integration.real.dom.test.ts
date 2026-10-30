// @vitest-environment jsdom
// The sequence GUI path end to end below the UI (docs/architecture.md §16.16.7): a Mermaid
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
const entryTarget = (source: string, position: number) => {
  const entry = view(source).entries[position];
  if (entry === undefined) throw new Error("no entry");
  return entry.target;
};

// Operations are built one after the other because a target names the text it was made from.
const STEPS: readonly ((source: string) => SequenceOperation)[] = [
  () => ({ kind: "setTitle", title: "Greeting" }),
  () => ({
    kind: "addParticipant",
    participantKind: "actor",
    label: "Carol",
    id: "C",
  }),
  (source) => ({
    kind: "addMessage",
    from: "B",
    to: "C",
    arrow: "->>",
    text: "forward",
    after: entryTarget(source, 0),
  }),
  (source) => ({
    kind: "editMessageText",
    target: entryTarget(source, 0),
    text: "Hello; there",
  }),
  (source) => ({
    kind: "moveMessage",
    target: entryTarget(source, 2),
    direction: "up",
  }),
  () => ({
    kind: "addNote",
    placement: "over",
    participants: ["A", "C"],
    text: "all three",
  }),
  () => ({ kind: "setAutonumber", enabled: true }),
];
const FINAL = [
  "sequenceDiagram",
  "  autonumber",
  "  title Greeting",
  "  participant A as Alice",
  "  participant B as Bob",
  "  actor C as Carol",
  "  A->>B: Hello#59; there",
  "  B-->>A: Hi",
  "  B->>C: forward",
  "  Note over A,C: all three",
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

describe("sequence GUI operations, save, reload, undo", () => {
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

    // What `git diff` of the .mmd file would show: the old lines all survive.
    expect(diffLines(ORIGINAL, FINAL)).toEqual({
      added: [
        "  autonumber",
        "  title Greeting",
        "  actor C as Carol",
        "  A->>B: Hello#59; there",
        "  B->>C: forward",
        "  Note over A,C: all three",
      ],
      removed: ["  A->>B: Hello"],
    });

    // Reload: a new session over the stored file reads the same, editable diagram.
    const reloaded = openSession([BLOCK]);
    reloaded.gateway.files.set(
      BLOCK.contentPath,
      harness.gateway.files.get(BLOCK.contentPath) ?? "",
    );
    await reloaded.session.loadSheetContents(SHEET_ID);
    expect(contentOf(reloaded)).toBe(FINAL);
    expect(analyzeDiagramSource(FINAL).editability).toEqual({
      editable: true,
      type: "sequence",
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

  it("leaves every untouched byte of a hand-written diagram alone", async () => {
    const handWritten =
      "%% my notes\r\nsequenceDiagram\r\n\tA->>B: Hi   # keep\r\n\r\n  %% keep\r\n  B-->>A: Ok; A->>B: Bye\r\n";
    const harness = openSession([BLOCK]);
    harness.gateway.files.set(BLOCK.contentPath, handWritten);
    await harness.session.loadSheetContents(SHEET_ID);
    const outcome = await runOperation(harness, {
      kind: "editMessageText",
      target: entryTarget(handWritten.replaceAll("\r\n", "\n"), 2),
      text: "Goodbye",
    });
    expect(outcome.ok).toBe(true);
    // The command stores LF (docs/file-format.md §9.2); apart from that only the text of the
    // last message changed, and the comment, the blank line and the `;` stayed.
    expect(contentOf(harness)).toBe(
      handWritten.replaceAll("\r\n", "\n").replace("Bye", "Goodbye"),
    );
  });
});
