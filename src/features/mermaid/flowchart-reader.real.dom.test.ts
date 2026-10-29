// @vitest-environment jsdom
// Differential test of the flowchart reader (src/domain/diagram/flowchart/) against the real
// Mermaid library (12.1.0): for every input, does Mermaid accept it, does the app draw it, did
// the reader fully read it, and do the two meanings agree? The reader may refuse (opaque)
// what Mermaid accepts; it must never fully read what Mermaid rejects (over-accept) and never
// read something other than Mermaid reads (mismatch). Layout values come from a fake in
// jsdom, so "draws" means the real renderer and the SVG sanitiser accept the text.
import mermaid from "mermaid";
import { beforeAll, describe, expect, it } from "vitest";
import { flowchartEditability } from "../../domain/diagram/flowchart/flowchart-editability";
import { readFlowchart } from "../../domain/diagram/flowchart/flowchart-reader";
import { createDiagramRenderCheck } from "./diagram-render-check";
import { mermaidRenderer } from "./render-mermaid";
import {
  type FlowchartCorpusCase,
  loadAppFlowchartCases,
  loadFlowchartCorpus,
  loadGuiFlowchartCases,
} from "./test-support/flowchart-corpus";
import {
  generateProgram,
  seededRandom,
} from "./test-support/flowchart-generator";
import {
  comparableOf,
  firstDifference,
} from "./test-support/flowchart-meaning-comparison";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";
import { readFlowchartWithMermaid } from "./test-support/mermaid-flowchart-db";

beforeAll(installFakeSvgMeasurement);

const renderCheck = createDiagramRenderCheck(mermaidRenderer);

// Seeded random programs. 600 programs with seed 2026 are the size of the Step 9-5 research
// run; the file as a whole stays within a minute in the container.
const FUZZ_SEED = 2026;
const FUZZ_PROGRAM_COUNT = 600;
const GENERATOR_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 300_000;

// Mermaid parses `(-x-)` but its renderer has no ellipse: the only fully read input that
// may fail to draw (docs/architecture.md §16.15.2). Later steps never offer the shape.
const ELLIPSE_RENDER_FAILURE = /No such shape: ellipse/;

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
  c1: {
    inputs: 237,
    fullyRead: 167,
    mismatch: 0,
    overAccept: 0,
    opaqueButMermaidAccepts: 28,
    bothReject: 42,
    renderFailuresAmongFullyRead: 1,
  },
  c2: {
    inputs: 97,
    fullyRead: 67,
    mismatch: 0,
    overAccept: 0,
    opaqueButMermaidAccepts: 20,
    bothReject: 10,
    renderFailuresAmongFullyRead: 0,
  },
  R: {
    inputs: 6,
    fullyRead: 6,
    mismatch: 0,
    overAccept: 0,
    opaqueButMermaidAccepts: 0,
    bothReject: 0,
    renderFailuresAmongFullyRead: 0,
  },
  cand: {
    inputs: 132,
    fullyRead: 117,
    mismatch: 0,
    overAccept: 0,
    opaqueButMermaidAccepts: 6,
    bothReject: 9,
    renderFailuresAmongFullyRead: 1,
  },
  fixtures: {
    inputs: 14,
    fullyRead: 12,
    mismatch: 0,
    overAccept: 0,
    opaqueButMermaidAccepts: 0,
    bothReject: 2,
    renderFailuresAmongFullyRead: 0,
  },
  fuzz: {
    inputs: 600,
    fullyRead: 578,
    mismatch: 0,
    overAccept: 0,
    opaqueButMermaidAccepts: 0,
    bothReject: 22,
    renderFailuresAmongFullyRead: 0,
  },
};

interface Outcome {
  readonly counts: SetCounts;
  readonly problems: readonly string[];
}

async function runSet(
  inputs: readonly FlowchartCorpusCase[],
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
    const reference = await readFlowchartWithMermaid(input.source);
    const reading = readFlowchart(input.source);
    if (reading.meaning === null) {
      if (reference.accepted) opaqueButMermaidAccepts += 1;
      else bothReject += 1;
      // What the reader calls editable must at least be fully read.
      if (flowchartEditability(reading).editable) {
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
      reference.meaning,
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
        if (!ELLIPSE_RENDER_FAILURE.test(outcome.message)) {
          problems.push(
            `UNEXPLAINED RENDER FAILURE ${input.id}: ${outcome.message.slice(0, 160)}`,
          );
        }
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

const corpus = loadFlowchartCorpus();

function casesWithPrefix(prefix: string): readonly FlowchartCorpusCase[] {
  return corpus.cases.filter((entry) => entry.id.startsWith(prefix));
}

describe("flowchart reader against mermaid 12.1.0", () => {
  it("has the corpus the counts below are about", () => {
    expect(corpus.cases.length).toBe(472);
    expect(corpus.skippedScenarios).toBe(0);
    expect(mermaid).toBeDefined();
  });

  it(
    "syntax corpus 1 (c1:)",
    async () => {
      expectCounts(
        "c1",
        await runSet(casesWithPrefix("c1:"), { render: true }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "syntax corpus 2 (c2:)",
    async () => {
      expectCounts(
        "c2",
        await runSet(casesWithPrefix("c2:"), { render: true }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "reference diagrams (R:)",
    async () => {
      expectCounts("R", await runSet(casesWithPrefix("R:"), { render: true }));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "edit scenarios, text after the edit (cand:)",
    async () => {
      expectCounts(
        "cand",
        await runSet(casesWithPrefix("cand:"), { render: true }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "fixtures (sources.json flowchart cases and the app fixture)",
    async () => {
      const inputs = [...loadGuiFlowchartCases(), ...loadAppFlowchartCases()];
      expectCounts("fixtures", await runSet(inputs, { render: true }));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "random programs (seeded)",
    async () => {
      const random = seededRandom(FUZZ_SEED);
      const countEdges = async (program: string): Promise<number> => {
        const reading = await readFlowchartWithMermaid(program);
        return reading.accepted ? reading.meaning.edges.length : 0;
      };
      const programs: FlowchartCorpusCase[] = [];
      for (let index = 0; index < FUZZ_PROGRAM_COUNT; index += 1) {
        programs.push({
          id: `fuzz:${index}`,
          group: "random",
          source: await generateProgram(random, countEdges),
          note: `seed ${FUZZ_SEED}`,
        });
      }
      expectCounts("fuzz", await runSet(programs, { render: false }));
    },
    GENERATOR_TIMEOUT_MS + TEST_TIMEOUT_MS,
  );
});
