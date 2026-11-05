// @vitest-environment jsdom
// The pie operations against the real mermaid 12.3.0: every
// candidate an operation produces must be drawn by the real renderer (through the same
// render check the app uses), and mermaid's own pie db must hold exactly the meaning the
// operation promised. The db is read through an internal API and only here, in tests.
import { beforeAll, describe, expect, it } from "vitest";
import { editBlockContentCommand } from "../../application/commands/content-commands";
import { applyValidatedDiagramOperation } from "../../application/diagram/apply-validated-diagram-operation";
import {
  DOCUMENT_ID,
  makeBlockAt,
  SHEET_ID,
} from "../../application/test-support/fakes";
import { openSession } from "../../application/test-support/session-harness";
import { pieEditability } from "../../domain/diagram/pie/pie-editability";
import {
  type PieOperation,
  planPieOperation,
  verifyPieCandidate,
} from "../../domain/diagram/pie/pie-operations";
import { parsePie } from "../../domain/diagram/pie/pie-parser";
import { loadMermaidGuiFixtures } from "../../domain/diagram/test-fixtures";
import { applyTextEdits } from "../../domain/diagram/text-edit";
import { createDiagramRenderCheck } from "./diagram-render-check";
import { mermaidRenderer } from "./render-mermaid";
import { sanitizeSvg } from "./sanitize-svg";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";
import { readPieWithMermaid } from "./test-support/mermaid-pie-db";

beforeAll(installFakeSvgMeasurement);

const renderCheck = createDiagramRenderCheck(mermaidRenderer);

const REPRESENTATIVE_SOURCES: Readonly<Record<string, string>> = {
  plain: 'pie\n  "Dogs" : 386\n  "Cats" : 85\n  "Rats" : 15\n',
  empty: "pie\n",
  crlf: 'pie\r\n  "Dogs" : 386\r\n  "Cats" : 85\r\n',
  noTrailingNewline: 'pie\n  "Dogs" : 386\n  "Cats" : 85',
  rich: '---\ntitle: FM\n---\n%%{init: {"theme":"forest"}}%%\npie showData title Pets\n  %% a comment\n\n  accDescr {\n    long description\n  }\n  "Dogs" : 386   %% trailing\n\t"Cats":85\n  "Japanese 犬🐶" : 1.5\n',
  titleLine: 'pie\n  title Old\n  "A" : 1\n  "B" : 2\n',
  singleQuoted: "pie\n  'A' : 1\n  \"B\" : 2\n",
};

// Labels and values that exercise the encoder; refusals are tested in the domain tests.
const LABELS = [
  "New",
  'Say "x"',
  "犬🐶 emoji",
  " spaced ",
  "a%%b",
  "<b>x</b>",
  'a <a href="q"> b',
  "a];b",
  "a : b",
  "a#b",
  "",
  "x'y",
];
const VALUES = ["0", "1.50", "12345", "0.000001", "007.5"];
const TITLES = ["Pets", "犬 title", 'say "hi"', "<b>x</b>", "a'b"];

interface Candidate {
  readonly label: string;
  readonly operation: PieOperation;
}

function operationsFor(source: string): readonly Candidate[] {
  const parsed = parsePie(source);
  const slices = parsed.slices;
  const candidates: Candidate[] = [];
  const add = (label: string, operation: PieOperation) =>
    candidates.push({ label, operation });
  for (const label of LABELS) {
    for (const index of [0, Math.floor(slices.length / 2), slices.length]) {
      add(`add ${JSON.stringify(label)} at ${index}`, {
        kind: "addSlice",
        label,
        valueText: "3",
        index,
      });
    }
  }
  for (const valueText of VALUES) {
    add(`add value ${valueText}`, {
      kind: "addSlice",
      label: "ValueProbe",
      valueText,
    });
  }
  slices.forEach((slice, index) => {
    const target = { index, label: slice.label };
    for (const label of LABELS)
      add(`rename ${index} to ${JSON.stringify(label)}`, {
        kind: "renameSlice",
        target,
        label,
      });
    for (const valueText of VALUES)
      add(`value ${index} = ${valueText}`, {
        kind: "setSliceValue",
        target,
        valueText,
      });
    add(`delete ${index}`, { kind: "deleteSlice", target });
    for (let toIndex = 0; toIndex < slices.length; toIndex += 1) {
      add(`move ${index} to ${toIndex}`, {
        kind: "moveSlice",
        target,
        toIndex,
      });
    }
  });
  for (const title of TITLES)
    add(`title ${JSON.stringify(title)}`, { kind: "setTitle", title });
  add("remove title", { kind: "removeTitle" });
  return candidates;
}

async function expectCandidateIsRight(source: string, candidate: Candidate) {
  const plan = planPieOperation(source, candidate.operation);
  if (!plan.ok) return "refused" as const;
  const applied = applyTextEdits(source, plan.value.edits);
  expect(applied.ok, candidate.label).toBe(true);
  if (!applied.ok) return "failed" as const;
  const text = applied.value.text;
  expect(
    verifyPieCandidate(text, plan.value.expected).ok,
    candidate.label,
  ).toBe(true);
  expect(await renderCheck(text), candidate.label).toEqual({ ok: true });
  const reading = await readPieWithMermaid(text);
  expect(reading.accepted, `${candidate.label}: mermaid accepts`).toBe(true);
  if (reading.accepted) {
    expect(reading.meaning, `${candidate.label}: mermaid's db`).toEqual(
      plan.value.expected,
    );
  }
  return "done" as const;
}

describe("pie operations against mermaid 12.3.0", () => {
  it.each(Object.entries(REPRESENTATIVE_SOURCES))(
    "%s: every produced candidate draws and Mermaid reads the promised meaning",
    async (name, source) => {
      expect(
        (await readPieWithMermaid(source)).accepted,
        "the input itself",
      ).toBe(true);
      const editable = pieEditability(parsePie(source)).editable;
      const results = { done: 0, refused: 0 };
      for (const candidate of operationsFor(source)) {
        const result = await expectCandidateIsRight(source, candidate);
        if (result === "done") results.done += 1;
        if (result === "refused") results.refused += 1;
      }
      if (name === "singleQuoted") {
        // Single-quoted labels are read; renaming them is refused, the rest works.
        expect(editable).toBe(true);
        expect(results.refused).toBeGreaterThan(0);
      }
      expect(results.done).toBeGreaterThan(10);
    },
    120_000,
  );

  it("draws the decoded label: a double quote written as #quot; is shown as a quote", async () => {
    const plan = planPieOperation('pie\n  "A" : 1\n', {
      kind: "addSlice",
      label: 'say "x"',
      valueText: "2",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const applied = applyTextEdits('pie\n  "A" : 1\n', plan.value.edits);
    if (!applied.ok) throw new Error("edits");
    const outcome = await mermaidRenderer.render(applied.value.text, {});
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const svg = new DOMParser().parseFromString(
      sanitizeSvg(outcome.svg),
      "image/svg+xml",
    );
    const texts = [...svg.querySelectorAll("text")].map(
      (node) => node.textContent,
    );
    expect(texts).toContain('say "x"');
  });

  it("every pie fixture Mermaid rejects is not editable, and every editable one works", async () => {
    const fixtures = loadMermaidGuiFixtures().filter(
      (fixture) => fixture.diagram === "pie",
    );
    expect(fixtures.length).toBeGreaterThan(0);
    for (const fixture of fixtures) {
      expect(
        fixture.futureBehaviour,
        `${fixture.id} has no pie future behaviour to assert`,
      ).toBeUndefined();
      const reading = await readPieWithMermaid(fixture.source);
      expect(reading.accepted, fixture.id).toBe(fixture.mermaidParses);
      const editability = pieEditability(parsePie(fixture.source));
      if (!fixture.mermaidParses)
        expect(editability.editable, fixture.id).toBe(false);
      if (!editability.editable) continue;
      for (const candidate of operationsFor(fixture.source)) {
        await expectCandidateIsRight(fixture.source, candidate);
      }
    }
  }, 120_000);

  it("runs through the session with the real render check: one entry, one undo", async () => {
    const block = makeBlockAt(1, 0, 0, "mermaid");
    const source = REPRESENTATIVE_SOURCES.plain as string;
    const harness = openSession([block]);
    await harness.session.loadSheetContents(SHEET_ID);
    await harness.session.execute(
      editBlockContentCommand({
        sheetId: SHEET_ID,
        blockId: block.blockId,
        text: source,
      }),
    );
    harness.session.clearHistory();
    const outcome = await applyValidatedDiagramOperation(
      harness.session,
      {
        documentId: DOCUMENT_ID,
        sheetId: SHEET_ID,
        blockId: block.blockId,
        operation: {
          diagram: "pie",
          operation: { kind: "addSlice", label: 'Cows "moo"', valueText: "7" },
        },
      },
      renderCheck,
    );
    expect(outcome).toEqual({ ok: true, value: { changed: true } });
    expect(harness.session.getState().contents.get(block.blockId)).toBe(
      `${source}  "Cows #quot;moo#quot;" : 7\n`,
    );
    await harness.session.undo();
    expect(harness.session.getState().contents.get(block.blockId)).toBe(source);
    expect(harness.session.getState().history.canUndo).toBe(false);
  });

  it("the real render check rejects text Mermaid cannot draw", async () => {
    const outcome = await renderCheck('pie\n  "A" : -1\n');
    expect(outcome.ok).toBe(false);
  });
});
