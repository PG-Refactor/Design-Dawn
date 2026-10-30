// @vitest-environment jsdom
// The flowchart GUI path end to end below the UI (docs/architecture.md §16.15.13): a new
// Mermaid block's source, edited by GUI operations through the Application gate with the
// real render check, saved through the normal auto-save, reloaded from the stored file,
// and undone / redone. The stored file is compared line by line with the original, which is
// what a Git diff of the `.mmd` file would show.
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
import type { FlowchartOperation } from "../../domain/diagram/flowchart/flowchart-operations";
import { createDiagramRenderCheck } from "./diagram-render-check";
import { MERMAID_BLOCK_DEFAULTS } from "./mermaid-block-defaults";
import { mermaidRenderer } from "./render-mermaid";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";

beforeAll(installFakeSvgMeasurement);

const renderCheck = createDiagramRenderCheck(mermaidRenderer);
const BLOCK = makeBlockAt(1, 0, 0, "mermaid");
const ORIGINAL = MERMAID_BLOCK_DEFAULTS.initialText;
const OPERATIONS: readonly FlowchartOperation[] = [
  { kind: "setNodeLabel", nodeId: "A", label: "Begin" },
  { kind: "addNode", label: "Review", id: "C" },
  { kind: "addEdge", from: "B", to: "C", label: "ok" },
  {
    kind: "setEdgeKind",
    target: { index: 0, id: "L_A_B_0" },
    link: { type: "arrow_point", stroke: "dotted" },
  },
  { kind: "setDirection", direction: "LR" },
];
const FINAL = [
  "flowchart LR",
  '  A["Begin"] -.-> B[End]',
  '  C["Review"]',
  '  B -->|"ok"| C',
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

async function runAll(harness: ReturnType<typeof openSession>) {
  for (const operation of OPERATIONS) {
    const outcome = await applyValidatedDiagramOperation(
      harness.session,
      {
        documentId: DOCUMENT_ID,
        sheetId: SHEET_ID,
        blockId: BLOCK.blockId,
        operation: { diagram: "flowchart", operation },
      },
      renderCheck,
    );
    expect(outcome, JSON.stringify(operation)).toEqual({
      ok: true,
      value: { changed: true },
    });
  }
}
const contentOf = (harness: ReturnType<typeof openSession>) =>
  harness.session.getState().contents.get(BLOCK.blockId);

describe("flowchart GUI operations, save, reload, undo", () => {
  it("edits, saves, reloads and undoes with only the touched lines changing", async () => {
    const harness = openSession([BLOCK]);
    harness.gateway.files.set(BLOCK.contentPath, ORIGINAL);
    await harness.session.loadSheetContents(SHEET_ID);
    expect(contentOf(harness)).toBe(ORIGINAL);

    await runAll(harness);
    expect(contentOf(harness)).toBe(FINAL);

    // The normal auto-save writes the block once; nothing else is written.
    harness.gateway.clearCalls();
    harness.scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await harness.session.flush();
    expect(harness.gateway.files.get(BLOCK.contentPath)).toBe(FINAL);
    expect(harness.gateway.methods()).toEqual(["writeBlockContent"]);

    // What `git diff` of the .mmd file would show.
    expect(diffLines(ORIGINAL, FINAL)).toEqual({
      added: [
        "flowchart LR",
        '  A["Begin"] -.-> B[End]',
        '  C["Review"]',
        '  B -->|"ok"| C',
      ],
      removed: ["flowchart TD", "  A[Start] --> B[End]"],
    });

    // Reload: a new session over the stored file reads the same, editable flowchart.
    const reloaded = openSession([BLOCK]);
    reloaded.gateway.files.set(
      BLOCK.contentPath,
      harness.gateway.files.get(BLOCK.contentPath) ?? "",
    );
    await reloaded.session.loadSheetContents(SHEET_ID);
    expect(contentOf(reloaded)).toBe(FINAL);
    expect(analyzeDiagramSource(FINAL).editability).toEqual({
      editable: true,
      type: "flowchart",
    });

    // One undo per operation, then redo all.
    for (let step = OPERATIONS.length; step > 0; step -= 1) {
      expect(harness.session.getState().history.canUndo).toBe(true);
      await harness.session.undo();
    }
    expect(contentOf(harness)).toBe(ORIGINAL);
    expect(harness.session.getState().history.canUndo).toBe(false);
    for (let step = 0; step < OPERATIONS.length; step += 1) {
      await harness.session.redo();
    }
    expect(contentOf(harness)).toBe(FINAL);
    expect(harness.session.getState().history.canRedo).toBe(false);
  });

  it("leaves every untouched byte of a hand-written flowchart alone", async () => {
    const handWritten =
      "%% my notes\r\nflowchart  LR\r\n\tA[ Start ]-->B\r\n\r\n  %% keep\r\n  C --> D\r\n";
    const harness = openSession([BLOCK]);
    harness.gateway.files.set(BLOCK.contentPath, handWritten);
    await harness.session.loadSheetContents(SHEET_ID);
    const outcome = await applyValidatedDiagramOperation(
      harness.session,
      {
        documentId: DOCUMENT_ID,
        sheetId: SHEET_ID,
        blockId: BLOCK.blockId,
        operation: {
          diagram: "flowchart",
          operation: { kind: "setNodeLabel", nodeId: "D", label: "Done" },
        },
      },
      renderCheck,
    );
    expect(outcome.ok).toBe(true);
    // The command stores LF (docs/file-format.md §9.2); apart from that only D changed.
    expect(contentOf(harness)).toBe(
      handWritten.replaceAll("\r\n", "\n").replace("D\n", 'D["Done"]\n'),
    );
  });
});

const TIER_TWO_ORIGINAL = [
  "flowchart TD",
  "  A[Start] --> B[Mid]",
  "  B --> C[End]",
  "  linkStyle 1 stroke:#f00",
  "",
].join("\n");
const TIER_TWO_STEPS: readonly (readonly [FlowchartOperation, string])[] = [
  [
    { kind: "createSubgraph", title: "Core", id: "G1", memberId: "B" },
    `${TIER_TWO_ORIGINAL}  subgraph G1["Core"]\n    B\n  end\n`,
  ],
  [
    { kind: "setSubgraphDirection", subgraphId: "G1", direction: "LR" },
    `${TIER_TWO_ORIGINAL}  subgraph G1["Core"]\n    direction LR\n    B\n  end\n`,
  ],
  [
    { kind: "setSubgraphTitle", subgraphId: "G1", title: "Core part" },
    `${TIER_TWO_ORIGINAL}  subgraph G1["Core part"]\n    direction LR\n    B\n  end\n`,
  ],
  [
    { kind: "moveNodeToSubgraph", nodeId: "A", subgraphId: "G1" },
    `${TIER_TWO_ORIGINAL}  subgraph G1["Core part"]\n    direction LR\n    B\n    A\n  end\n`,
  ],
  [
    { kind: "deleteNode", nodeId: "C" },
    'flowchart TD\n  A[Start] --> B[Mid]\n  subgraph G1["Core part"]\n    direction LR\n    B\n    A\n  end\n',
  ],
  [
    { kind: "removeNodeFromSubgraph", nodeId: "A", subgraphId: "G1" },
    'flowchart TD\n  A[Start] --> B[Mid]\n  subgraph G1["Core part"]\n    direction LR\n    B\n  end\n',
  ],
  [
    { kind: "dissolveSubgraph", subgraphId: "G1" },
    "flowchart TD\n  A[Start] --> B[Mid]\n  B\n",
  ],
];

async function applyAll(
  harness: ReturnType<typeof openSession>,
  operations: readonly FlowchartOperation[],
) {
  for (const operation of operations) {
    const outcome = await applyValidatedDiagramOperation(
      harness.session,
      {
        documentId: DOCUMENT_ID,
        sheetId: SHEET_ID,
        blockId: BLOCK.blockId,
        operation: { diagram: "flowchart", operation },
      },
      renderCheck,
    );
    expect(outcome, JSON.stringify(operation)).toEqual({
      ok: true,
      value: { changed: true },
    });
  }
}

describe("flowchart Tier 2 operations, save, reload, undo", () => {
  it("edits, saves, reloads and undoes one operation at a time", async () => {
    const harness = openSession([BLOCK]);
    harness.gateway.files.set(BLOCK.contentPath, TIER_TWO_ORIGINAL);
    await harness.session.loadSheetContents(SHEET_ID);

    // Each operation is one undo step and produces exactly the expected text.
    const texts = [TIER_TWO_ORIGINAL];
    for (const [operation, expected] of TIER_TWO_STEPS) {
      await applyAll(harness, [operation]);
      expect(contentOf(harness), operation.kind).toBe(expected);
      texts.push(expected);
    }
    const final = texts[texts.length - 1] as string;

    // The normal auto-save writes the block once; nothing else is written.
    harness.gateway.clearCalls();
    harness.scheduler.advance(TEST_AUTO_SAVE_DELAY_MS);
    await harness.session.flush();
    expect(harness.gateway.files.get(BLOCK.contentPath)).toBe(final);
    expect(harness.gateway.methods()).toEqual(["writeBlockContent"]);

    // Reload: a new session over the stored file reads the same, editable flowchart.
    const reloaded = openSession([BLOCK]);
    reloaded.gateway.files.set(
      BLOCK.contentPath,
      harness.gateway.files.get(BLOCK.contentPath) ?? "",
    );
    await reloaded.session.loadSheetContents(SHEET_ID);
    expect(contentOf(reloaded)).toBe(final);
    expect(analyzeDiagramSource(final).editability).toEqual({
      editable: true,
      type: "flowchart",
    });

    // One undo per operation walks back through every text, then redo walks forward.
    for (let step = TIER_TWO_STEPS.length; step > 0; step -= 1) {
      await harness.session.undo();
      expect(contentOf(harness)).toBe(texts[step - 1]);
    }
    expect(harness.session.getState().history.canUndo).toBe(false);
    for (let step = 1; step <= TIER_TWO_STEPS.length; step += 1) {
      await harness.session.redo();
      expect(contentOf(harness)).toBe(texts[step]);
    }
    expect(harness.session.getState().history.canRedo).toBe(false);
  });
});
