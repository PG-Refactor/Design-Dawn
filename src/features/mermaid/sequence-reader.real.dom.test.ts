// @vitest-environment jsdom
// Differential test of the sequence reader (src/domain/diagram/sequence/) against the real
// Mermaid library (12.3.0): for every input, does Mermaid accept it, does the app draw it, did
// the reader fully read it, and do the two meanings agree? The reader may refuse (opaque)
// what Mermaid accepts; it must never fully read what Mermaid rejects (over-accept) and never
// read something other than Mermaid reads (mismatch). Layout values come from a fake in
// jsdom, so "draws" means the real renderer and the SVG sanitiser accept the text.
import mermaid from "mermaid";
import { beforeAll, describe, expect, it } from "vitest";
import { sequenceEditability } from "../../domain/diagram/sequence/sequence-editability";
import { readSequence } from "../../domain/diagram/sequence/sequence-reader";
import { createDiagramRenderCheck } from "./diagram-render-check";
import { mermaidRenderer } from "./render-mermaid";
import { seededRandom } from "./test-support/flowchart-generator";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";
import { readSequenceWithMermaid } from "./test-support/mermaid-sequence-db";
import {
  comparableOf,
  firstDifference,
} from "./test-support/sequence-comparison";
import {
  loadAppSequenceCases,
  loadGuiSequenceCases,
  loadSequenceCorpus,
  type SequenceCorpusCase,
} from "./test-support/sequence-corpus";
import { generateSequenceProgram } from "./test-support/sequence-generator";

beforeAll(installFakeSvgMeasurement);

const renderCheck = createDiagramRenderCheck(mermaidRenderer);

// 700 programs with seed 2026 are the size of the earlier research run.
const FUZZ_SEED = 2026;
const FUZZ_PROGRAM_COUNT = 700;
const TEST_TIMEOUT_MS = 600_000;

interface SetCounts {
  readonly inputs: number;
  readonly fullyRead: number;
  readonly mismatch: number;
  readonly overAccept: number;
  readonly opaqueButMermaidAccepts: number;
  readonly bothReject: number;
  readonly renderFailuresAmongFullyRead: number;
}

// Fixed on purpose: when the reader or Mermaid changes, the numbers move and the failure
// message shows both sets of counts. Update them only after looking at why.
const EXPECTED_COUNTS: Readonly<Record<string, SetCounts>> = {
  corpus: {
    inputs: 361,
    fullyRead: 185,
    mismatch: 0,
    overAccept: 0,
    opaqueButMermaidAccepts: 110,
    bothReject: 66,
    renderFailuresAmongFullyRead: 0,
  },
  cand: {
    inputs: 219,
    fullyRead: 171,
    mismatch: 0,
    overAccept: 0,
    opaqueButMermaidAccepts: 32,
    bothReject: 16,
    renderFailuresAmongFullyRead: 0,
  },
  fixtures: {
    inputs: 8,
    fullyRead: 6,
    mismatch: 0,
    overAccept: 0,
    opaqueButMermaidAccepts: 0,
    bothReject: 2,
    renderFailuresAmongFullyRead: 0,
  },
  fuzz: {
    inputs: 700,
    fullyRead: 339,
    mismatch: 0,
    overAccept: 0,
    opaqueButMermaidAccepts: 224,
    bothReject: 137,
    renderFailuresAmongFullyRead: 0,
  },
};

interface Outcome {
  readonly counts: SetCounts;
  readonly problems: readonly string[];
}

async function runSet(
  inputs: readonly SequenceCorpusCase[],
  options: { readonly render: boolean },
): Promise<Outcome> {
  let fullyRead = 0;
  let mismatch = 0;
  let overAccept = 0;
  let opaqueButMermaidAccepts = 0;
  let bothReject = 0;
  let renderFailures = 0;
  const problems: string[] = [];
  for (const input of inputs) {
    const reference = await readSequenceWithMermaid(input.source);
    const reading = readSequence(input.source);
    if (reading.meaning === null) {
      if (reference.accepted) opaqueButMermaidAccepts += 1;
      else bothReject += 1;
      // What the reader calls editable must at least be fully read.
      if (sequenceEditability(reading).editable) {
        problems.push(`${input.id}: editable without a meaning`);
      }
      continue;
    }
    fullyRead += 1;
    if (!reference.accepted) {
      overAccept += 1;
      problems.push(
        `OVER-ACCEPT ${input.id}: mermaid says ${reference.message.slice(0, 120)}\n    ${JSON.stringify(input.source).slice(0, 300)}`,
      );
      continue;
    }
    const difference = firstDifference(
      comparableOf(reading.meaning),
      reference.sequence,
    );
    if (difference !== null) {
      mismatch += 1;
      problems.push(
        `MISMATCH ${input.id}: ${difference}\n    ${JSON.stringify(input.source).slice(0, 300)}`,
      );
    }
    if (options.render) {
      const outcome = await renderCheck(input.source);
      if (!outcome.ok) {
        renderFailures += 1;
        problems.push(
          `RENDER FAILURE ${input.id}: ${outcome.message.slice(0, 160)}`,
        );
      }
    }
  }
  return {
    counts: {
      inputs: inputs.length,
      fullyRead,
      mismatch,
      overAccept,
      opaqueButMermaidAccepts,
      bothReject,
      renderFailuresAmongFullyRead: renderFailures,
    },
    problems,
  };
}

function expectCounts(setName: string, outcome: Outcome): void {
  expect(outcome.problems, `${setName}: problems`).toEqual([]);
  expect(
    outcome.counts,
    `${setName}: counts changed (reader or mermaid differs from the recorded run)`,
  ).toEqual(EXPECTED_COUNTS[setName]);
}

const corpus = loadSequenceCorpus();

function casesWithPrefix(prefix: string): readonly SequenceCorpusCase[] {
  return corpus.cases.filter((entry) => entry.id.startsWith(prefix));
}

describe("sequence reader against mermaid 12.3.0", () => {
  it("has the corpus the counts below are about", () => {
    expect(corpus.cases.length).toBe(580);
    expect(mermaid).toBeDefined();
  });

  it(
    "syntax corpus (SQ-)",
    async () => {
      expectCounts(
        "corpus",
        await runSet(casesWithPrefix("SQ-"), { render: true }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "edit scenarios, text before and after the research edits (cand:)",
    async () => {
      expectCounts(
        "cand",
        await runSet(casesWithPrefix("cand:"), { render: true }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "fixtures (sources.json sequence cases and the app fixture)",
    async () => {
      const inputs = [...loadGuiSequenceCases(), ...loadAppSequenceCases()];
      expectCounts("fixtures", await runSet(inputs, { render: true }));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "random programs (seeded)",
    async () => {
      const random = seededRandom(FUZZ_SEED);
      const programs: SequenceCorpusCase[] = [];
      for (let index = 0; index < FUZZ_PROGRAM_COUNT; index += 1) {
        programs.push({
          id: `fuzz:${index}`,
          group: "random",
          source: generateSequenceProgram(random),
          note: `seed ${FUZZ_SEED}`,
        });
      }
      expectCounts("fuzz", await runSet(programs, { render: false }));
    },
    TEST_TIMEOUT_MS,
  );
});
