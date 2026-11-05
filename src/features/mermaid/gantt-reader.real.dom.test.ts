// @vitest-environment jsdom
// Differential test of the gantt reader (src/domain/diagram/gantt/) against the real Mermaid
// library (12.3.0): for every input, does Mermaid accept it and draw it, does the reader call
// it editable, and do the meanings (and the dates, where the editor predicts them) agree? The
// reader may refuse what Mermaid accepts; it must never call editable what Mermaid rejects or
// cannot draw (over-accept) and never read something other than Mermaid reads (mismatch).
// Layout values come from a fake in jsdom, so "draws" means the real renderer and the SVG
// sanitiser accept the text. Mermaid's gantt module state is isolated before every
// measurement (test-support/mermaid-gantt-db.ts).
import mermaid from "mermaid";
import { beforeAll, describe, expect, it } from "vitest";
import { ganttEditability } from "../../domain/diagram/gantt/gantt-editability";
import {
  ganttMeaningOf,
  resolveGanttSchedule,
} from "../../domain/diagram/gantt/gantt-meaning";
import { parseGantt } from "../../domain/diagram/gantt/gantt-parser";
import { createDiagramRenderCheck } from "./diagram-render-check";
import { mermaidRenderer } from "./render-mermaid";
import { seededRandom } from "./test-support/flowchart-generator";
import {
  type GanttCorpusCase,
  loadGanttCorpus,
  loadGuiGanttCases,
} from "./test-support/gantt-corpus";
import { generateGanttProgram } from "./test-support/gantt-generator";
import {
  comparableOfDb,
  comparableOfMeaning,
  firstGanttDifference,
} from "./test-support/gantt-meaning-comparison";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";
import {
  isolateMermaidGanttState,
  readGanttWithMermaid,
  rememberGanttIds,
} from "./test-support/mermaid-gantt-db";

beforeAll(installFakeSvgMeasurement);

const renderCheck = createDiagramRenderCheck(mermaidRenderer);

const FUZZ_SEED = 777;
const FUZZ_PROGRAM_COUNT = 600;
const TEST_TIMEOUT_MS = 600_000;

interface SetCounts {
  readonly inputs: number;
  readonly editable: number;
  readonly mismatch: number;
  readonly overAccept: number;
  readonly dateMismatch: number;
  readonly datesChecked: number;
  readonly opaqueButMermaidAccepts: number;
  readonly bothReject: number;
}

// Fixed on purpose: when the reader or Mermaid changes, the numbers move and the failure
// message shows both sets of counts. Update them only after looking at why.
const EXPECTED_COUNTS: Readonly<Record<string, SetCounts>> = {
  syntax: {
    inputs: 281,
    editable: 147,
    mismatch: 0,
    overAccept: 0,
    dateMismatch: 0,
    datesChecked: 213,
    opaqueButMermaidAccepts: 92,
    bothReject: 42,
  },
  before: {
    inputs: 68,
    editable: 63,
    mismatch: 0,
    overAccept: 0,
    dateMismatch: 0,
    datesChecked: 278,
    opaqueButMermaidAccepts: 5,
    bothReject: 0,
  },
  naive: {
    inputs: 68,
    editable: 31,
    mismatch: 0,
    overAccept: 0,
    dateMismatch: 0,
    datesChecked: 136,
    opaqueButMermaidAccepts: 24,
    bothReject: 13,
  },
  fixtures: {
    inputs: 6,
    editable: 5,
    mismatch: 0,
    overAccept: 0,
    dateMismatch: 0,
    datesChecked: 10,
    opaqueButMermaidAccepts: 0,
    bothReject: 1,
  },
  fuzz: {
    inputs: 600,
    editable: 151,
    mismatch: 0,
    overAccept: 0,
    dateMismatch: 0,
    datesChecked: 516,
    opaqueButMermaidAccepts: 254,
    bothReject: 195,
  },
};

interface Outcome {
  readonly counts: SetCounts;
  readonly problems: readonly string[];
}

async function runSet(inputs: readonly GanttCorpusCase[]): Promise<Outcome> {
  for (const input of inputs) rememberGanttIds(input.source);
  let editable = 0;
  let mismatch = 0;
  let overAccept = 0;
  let dateMismatch = 0;
  let datesChecked = 0;
  let opaqueButMermaidAccepts = 0;
  let bothReject = 0;
  const problems: string[] = [];
  for (const input of inputs) {
    const reference = await readGanttWithMermaid(input.source);
    let mermaidOk = reference.accepted && reference.db.tasks !== null;
    if (mermaidOk) {
      await isolateMermaidGanttState();
      mermaidOk = (await renderCheck(input.source)).ok;
    }
    const parsed = parseGantt(input.source);
    const verdict = ganttEditability(parsed);
    if (!verdict.editable) {
      if (mermaidOk) opaqueButMermaidAccepts += 1;
      else bothReject += 1;
      continue;
    }
    editable += 1;
    const shown = JSON.stringify(input.source).slice(0, 300);
    if (!mermaidOk || !reference.accepted) {
      overAccept += 1;
      problems.push(
        `OVER-ACCEPT ${input.id}: ${reference.accepted ? (reference.db.tasksError ?? "render fails") : reference.message}\n    ${shown}`,
      );
      continue;
    }
    const meaning = ganttMeaningOf(parsed);
    const database = comparableOfDb(reference.db);
    if (meaning === null || database === null) {
      problems.push(`NO MEANING ${input.id}`);
      continue;
    }
    const difference = firstGanttDifference(
      comparableOfMeaning(meaning),
      database,
    );
    if (difference !== null) {
      mismatch += 1;
      problems.push(`MISMATCH ${input.id}: ${difference}\n    ${shown}`);
      continue;
    }
    const schedule = resolveGanttSchedule(meaning);
    (reference.db.tasks ?? []).forEach((task, index) => {
      const dates = schedule[index];
      if (dates === null || dates === undefined) return;
      datesChecked += 1;
      if (dates.start !== task.start || dates.end !== task.end) {
        dateMismatch += 1;
        problems.push(
          `DATE MISMATCH ${input.id} task ${index}: ours ${dates.start}..${dates.end}, mermaid ${task.start}..${task.end}\n    ${shown}`,
        );
      }
    });
  }
  return {
    counts: {
      inputs: inputs.length,
      editable,
      mismatch,
      overAccept,
      dateMismatch,
      datesChecked,
      opaqueButMermaidAccepts,
      bothReject,
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

const corpus = loadGanttCorpus();

function casesOf(...groups: readonly string[]): readonly GanttCorpusCase[] {
  return corpus.cases.filter((entry) => groups.includes(entry.group));
}

describe("gantt reader against mermaid 12.3.0", () => {
  it("has the corpus the counts below are about", () => {
    expect(corpus.cases.length).toBe(417);
    expect(mermaid).toBeDefined();
  });

  it(
    "syntax corpus (GT-*)",
    async () => {
      const inputs = corpus.cases.filter((entry) => entry.id.startsWith("GT-"));
      expectCounts("syntax", await runSet(inputs));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "edit scenarios: the text before the edit",
    async () => {
      expectCounts("before", await runSet(casesOf("scenarioBefore")));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "edit scenarios: the text after the research's hand-made edit",
    async () => {
      expectCounts("naive", await runSet(casesOf("scenarioNaive")));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "fixtures (sources.json gantt cases)",
    async () => {
      expectCounts("fixtures", await runSet(loadGuiGanttCases()));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "random programs (seeded)",
    async () => {
      const random = seededRandom(FUZZ_SEED);
      const inputs: GanttCorpusCase[] = [];
      for (let index = 0; index < FUZZ_PROGRAM_COUNT; index += 1) {
        inputs.push({
          id: `fuzz-${index}`,
          group: "fuzz",
          source: generateGanttProgram(random),
          note: "",
        });
      }
      expectCounts("fuzz", await runSet(inputs));
    },
    TEST_TIMEOUT_MS,
  );
});
