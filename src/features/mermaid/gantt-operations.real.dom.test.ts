// @vitest-environment jsdom
// The gantt operations (src/domain/diagram/gantt/gantt-operations.ts) against the real
// mermaid 12.1.0: every candidate a plan produces must be
// accepted by Mermaid, drawn by the same render check the app uses, hold exactly the meaning
// the operation promised, and put every task where the editor's own date resolution says. The
// db is read through an internal API and only here, in tests, with Mermaid's module state
// isolated before every measurement (test-support/mermaid-gantt-db.ts).
//
// Three sets of inputs:
//   1. scenarios: typed operations on reference charts, each planned or refused with a named
//      reason;
//   2. naive edits: the text a plain line edit would give, to show Mermaid really draws it
//      differently (or not at all), which is why the editor refuses or does it another way;
//   3. seeded random operation sequences on every editable chart of the corpus.
import { beforeAll, describe, expect, it } from "vitest";
import { ganttEditability } from "../../domain/diagram/gantt/gantt-editability";
import {
  type GanttMeaning,
  resolveGanttSchedule,
} from "../../domain/diagram/gantt/gantt-meaning";
import {
  type GanttOperation,
  planGanttOperation,
  verifyGanttCandidate,
} from "../../domain/diagram/gantt/gantt-operations";
import { parseGantt } from "../../domain/diagram/gantt/gantt-parser";
import { applyTextEdits } from "../../domain/diagram/text-edit";
import { createDiagramRenderCheck } from "./diagram-render-check";
import { mermaidRenderer } from "./render-mermaid";
import { seededRandom } from "./test-support/flowchart-generator";
import {
  type GanttCorpusCase,
  loadGanttCorpus,
  loadGuiGanttCases,
} from "./test-support/gantt-corpus";
import {
  comparableOfDb,
  comparableOfMeaning,
  firstGanttDifference,
} from "./test-support/gantt-meaning-comparison";
import { randomGanttOperation } from "./test-support/gantt-operation-generator";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";
import {
  type DbGantt,
  isolateMermaidGanttState,
  readGanttWithMermaid,
  rememberGanttIds,
} from "./test-support/mermaid-gantt-db";

beforeAll(installFakeSvgMeasurement);

const renderCheck = createDiagramRenderCheck(mermaidRenderer);
const TEST_TIMEOUT_MS = 600_000;
const SEQUENCE_SEED = 4242;
const STEPS_PER_SEQUENCE = 6;

const REFERENCE = `gantt
    title Release plan
    dateFormat YYYY-MM-DD
    section Design
    Spec :done, des1, 2024-01-01, 3d
    Review :active, des2, after des1, 2d
    section Build
    Code :crit, b1, after des2, 5d
    Test :b2, after b1, 3d
    Release :milestone, m1, after b2, 0d
`;

const IMPLICIT = `gantt
    dateFormat YYYY-MM-DD
    section A
    First :2024-01-01, 2d
    Second :3d
    Third :2d
    section B
    Other :o1, 2024-02-01, 5d
    click o1 href "https://example.com/"
`;

// Section B starts where section A ends: anything put at the end of A moves it.
const CHAINED = `gantt
    dateFormat YYYY-MM-DD
    section A
    First :f1, 2024-01-01, 2d
    section B
    Second :3d
`;

const task = (index: number, name: string) => ({ index, name });
const section = (index: number, name: string) => ({ index, name });

interface Agreement {
  readonly agrees: boolean;
  readonly detail: string;
}

async function mermaidReads(candidate: string): Promise<DbGantt | string> {
  const reading = await readGanttWithMermaid(candidate);
  if (!reading.accepted) return `mermaid rejects: ${reading.message}`;
  if (reading.db.tasks === null)
    return `tasks do not compile: ${reading.db.tasksError}`;
  await isolateMermaidGanttState();
  const rendered = await renderCheck(candidate);
  return rendered.ok ? reading.db : `render fails: ${rendered.message}`;
}

// Does Mermaid read, draw and mean exactly what `expected` says, with the dates the editor
// predicts?
async function mermaidAgrees(
  candidate: string,
  expected: GanttMeaning,
): Promise<Agreement> {
  rememberGanttIds(candidate);
  const db = await mermaidReads(candidate);
  if (typeof db === "string") return { agrees: false, detail: db };
  const comparable = comparableOfDb(db);
  if (comparable === null) return { agrees: false, detail: "no db tasks" };
  const difference = firstGanttDifference(
    comparableOfMeaning(expected),
    comparable,
  );
  if (difference !== null)
    return { agrees: false, detail: `meaning differs: ${difference}` };
  const schedule = resolveGanttSchedule(expected);
  const tasks = db.tasks ?? [];
  for (const [index, dates] of schedule.entries()) {
    const real = tasks[index];
    if (dates === null || real === undefined) continue;
    if (dates.start !== real.start || dates.end !== real.end) {
      return {
        agrees: false,
        detail: `task ${index} dates: editor ${dates.start}..${dates.end}, mermaid ${real.start}..${real.end}`,
      };
    }
  }
  return { agrees: true, detail: "" };
}

interface Planned {
  readonly text: string;
  readonly expected: GanttMeaning;
}

function plan(source: string, operation: GanttOperation): Planned | string {
  const result = planGanttOperation(source, operation);
  if (!result.ok) return result.error.detail;
  const applied = applyTextEdits(source, result.value.edits);
  if (!applied.ok) return `edits: ${applied.error.detail}`;
  const verdict = verifyGanttCandidate(
    applied.value.text,
    result.value.expected,
  );
  if (!verdict.ok) return `verify: ${verdict.error.detail}`;
  return { text: applied.value.text, expected: result.value.expected };
}

interface Scenario {
  readonly name: string;
  readonly source: string;
  readonly operation: GanttOperation;
  // Undefined: the editor plans it and Mermaid must agree. Otherwise the refusal's reason.
  readonly refusal?: string;
}

const addDeploy: GanttOperation = {
  kind: "addTask",
  name: "Deploy",
  start: { kind: "after", ids: ["m1"] },
  end: { kind: "duration", text: "2d" },
};

const SCENARIOS: readonly Scenario[] = [
  {
    name: "set the title",
    source: REFERENCE,
    operation: { kind: "setTitle", title: "Plan B" },
  },
  {
    name: "add a title to an untitled chart",
    source: IMPLICIT,
    operation: { kind: "setTitle", title: "New" },
  },
  {
    name: "clear the title",
    source: REFERENCE,
    operation: { kind: "clearTitle" },
  },
  {
    name: "add a section at the end",
    source: REFERENCE,
    operation: { kind: "addSection", name: "Ship" },
  },
  {
    name: "add a section between two sections",
    source: REFERENCE,
    operation: { kind: "addSection", name: "QA", afterSectionIndex: 0 },
  },
  {
    name: "add a section after the last section",
    source: IMPLICIT,
    operation: { kind: "addSection", name: "C", afterSectionIndex: 1 },
  },
  {
    name: "rename a section",
    source: REFERENCE,
    operation: {
      kind: "renameSection",
      target: section(1, "Build"),
      name: "Make things",
    },
  },
  {
    name: "delete an empty section",
    source: `${REFERENCE}    section Empty\n`,
    operation: { kind: "deleteSection", target: section(2, "Empty") },
  },
  {
    name: "delete a section no one depends on",
    source: `${REFERENCE}    section Tail\n    Last :t1, 2024-03-01, 1d\n`,
    operation: { kind: "deleteSection", target: section(2, "Tail") },
  },
  {
    name: "delete a section the rest depends on",
    source: REFERENCE,
    operation: { kind: "deleteSection", target: section(0, "Design") },
    refusal: "danglingReference",
  },
  { name: "add a task at the end", source: REFERENCE, operation: addDeploy },
  {
    name: "add a task to a section, with tags",
    source: REFERENCE,
    operation: {
      kind: "addTask",
      sectionIndex: 0,
      name: "Sign off",
      id: "sg",
      tags: ["crit", "done"],
      start: { kind: "date", text: "2024-01-06" },
      end: { kind: "date", text: "2024-01-08" },
    },
  },
  {
    name: "add a task that ends when another starts",
    source: REFERENCE,
    operation: {
      kind: "addTask",
      name: "Prep",
      start: { kind: "date", text: "2024-01-02" },
      end: { kind: "until", ids: ["b1"] },
    },
  },
  {
    name: "add a task in front of an implicit start",
    source:
      "gantt\n    dateFormat YYYY-MM-DD\n    section A\n    First :f1, 2024-01-01, 2d\n    section B\n    Second :3d\n",
    operation: {
      kind: "addTask",
      sectionIndex: 0,
      name: "New",
      start: { kind: "date", text: "2024-01-01" },
      end: { kind: "duration", text: "1d" },
    },
    refusal: "implicitStart",
  },
  {
    name: "add a task with a colon in the name",
    source: REFERENCE,
    operation: { ...addDeploy, name: "Deploy: now" },
    refusal: "colon",
  },
  {
    name: "add a task whose name starts like a statement",
    source: REFERENCE,
    operation: { ...addDeploy, name: "title page" },
    refusal: "keywordLedName",
  },
  {
    name: "add a task whose name hides the line",
    source: REFERENCE,
    operation: { ...addDeploy, name: "5% rule" },
    refusal: "commentMark",
  },
  {
    name: "add a task with an impossible date",
    source: REFERENCE,
    operation: {
      kind: "addTask",
      name: "X",
      start: { kind: "date", text: "2024-02-30" },
      end: { kind: "duration", text: "1d" },
    },
    refusal: "invalidDate",
  },
  {
    name: "rename a task",
    source: REFERENCE,
    operation: {
      kind: "renameTask",
      target: task(2, "Code"),
      name: "Implementation",
    },
  },
  {
    name: "rename a task id with references",
    source: REFERENCE,
    operation: { kind: "setTaskId", target: task(0, "Spec"), id: "kickoff" },
  },
  {
    name: "rename a task id with a click",
    source: IMPLICIT,
    operation: { kind: "setTaskId", target: task(3, "Other"), id: "other" },
  },
  {
    name: "give a task without an id one",
    source: IMPLICIT,
    operation: { kind: "setTaskId", target: task(0, "First"), id: "f1" },
  },
  {
    name: "give a task an id that looks generated",
    source: REFERENCE,
    operation: { kind: "setTaskId", target: task(0, "Spec"), id: "task1" },
    refusal: "autoIdShape",
  },
  {
    name: "set a start date",
    source: REFERENCE,
    operation: {
      kind: "setStart",
      target: task(0, "Spec"),
      start: { kind: "date", text: "2024-03-04" },
    },
  },
  {
    name: "set a start after two tasks",
    source: REFERENCE,
    operation: {
      kind: "setStart",
      target: task(4, "Release"),
      start: { kind: "after", ids: ["b1", "b2"] },
    },
  },
  {
    name: "give an implicit start a date",
    source: IMPLICIT,
    operation: {
      kind: "setStart",
      target: task(1, "Second"),
      start: { kind: "date", text: "2024-01-09" },
    },
  },
  {
    name: "set a start that makes a circle",
    source: REFERENCE,
    operation: {
      kind: "setStart",
      target: task(0, "Spec"),
      start: { kind: "after", ids: ["m1"] },
    },
    refusal: "cyclicReference",
  },
  {
    name: "set a duration",
    source: REFERENCE,
    operation: { kind: "setDuration", target: task(2, "Code"), duration: "2w" },
  },
  {
    name: "set an end date",
    source: REFERENCE,
    operation: {
      kind: "setEnd",
      target: task(2, "Code"),
      end: { kind: "date", text: "2024-02-01" },
    },
  },
  {
    name: "set an end to until",
    source: REFERENCE,
    operation: {
      kind: "setEnd",
      target: task(4, "Release"),
      end: { kind: "until", ids: ["des1"] },
    },
  },
  {
    name: "set a duration Mermaid would zero",
    source: REFERENCE,
    operation: {
      kind: "setDuration",
      target: task(2, "Code"),
      duration: "5 days",
    },
    refusal: "invalidDuration",
  },
  {
    name: "set tags",
    source: REFERENCE,
    operation: {
      kind: "setStatusTags",
      target: task(3, "Test"),
      tags: ["vert", "done"],
    },
  },
  {
    name: "clear tags",
    source: REFERENCE,
    operation: { kind: "setStatusTags", target: task(0, "Spec"), tags: [] },
  },
  {
    name: "set tags on an implicit start",
    source: IMPLICIT,
    operation: {
      kind: "setStatusTags",
      target: task(1, "Second"),
      tags: ["crit"],
    },
  },
  {
    name: "delete the last task",
    source: REFERENCE,
    operation: { kind: "deleteTask", target: task(4, "Release") },
  },
  {
    name: "delete the last implicit task",
    source: IMPLICIT,
    operation: { kind: "deleteTask", target: task(2, "Third") },
  },
  {
    name: "delete a task that is referred to",
    source: REFERENCE,
    operation: { kind: "deleteTask", target: task(0, "Spec") },
    refusal: "danglingReference",
  },
  {
    name: "delete a task above an implicit start",
    source: IMPLICIT,
    operation: { kind: "deleteTask", target: task(0, "First") },
    refusal: "implicitStart",
  },
  {
    name: "delete a task with a click",
    source: IMPLICIT,
    operation: { kind: "deleteTask", target: task(3, "Other") },
    refusal: "clickLink",
  },
];

describe("gantt operations against mermaid 12.1.0: scenarios", () => {
  for (const scenario of SCENARIOS) {
    it(
      scenario.name,
      async () => {
        const planned = plan(scenario.source, scenario.operation);
        if (scenario.refusal !== undefined) {
          expect(typeof planned === "string" ? planned : "planned").toContain(
            scenario.refusal,
          );
          return;
        }
        expect(typeof planned === "string" ? planned : "").toBe("");
        const { text, expected } = planned as Planned;
        expect(text).not.toBe(scenario.source);
        expect(await mermaidAgrees(text, expected)).toEqual({
          agrees: true,
          detail: "",
        });
      },
      TEST_TIMEOUT_MS,
    );
  }
});

// The dates Mermaid draws for a chart, by task name.
async function drawnDates(
  source: string,
): Promise<Map<string, string> | string> {
  rememberGanttIds(source);
  const db = await mermaidReads(source);
  if (typeof db === "string") return db;
  return new Map(
    (db.tasks ?? []).map((entry) => [
      entry.name,
      `${entry.start}..${entry.end}`,
    ]),
  );
}

interface NaiveEdit {
  readonly name: string;
  readonly source: string;
  // The text a plain line edit gives.
  readonly naive: string;
  // What the editor does with the same intent.
  readonly operation: GanttOperation;
  readonly refusal: string;
  // The task whose dates a naive edit moves or breaks.
  readonly victim: string;
}

const NAIVE_EDITS: readonly NaiveEdit[] = [
  {
    name: "deleting the task above an implicit start moves it",
    source: IMPLICIT.replace("    Third :2d\n", ""),
    naive: IMPLICIT.replace("    First :2024-01-01, 2d\n", "")
      .replace("    Third :2d\n", "")
      .replace("Second :3d", "Second :3d"),
    operation: { kind: "deleteTask", target: task(0, "First") },
    refusal: "implicitStart",
    victim: "Second",
  },
  {
    name: "inserting a task in front of an implicit start moves it",
    source: CHAINED,
    naive: CHAINED.replace(
      "    Second :3d\n",
      "    Inserted :i1, 2024-06-01, 10d\n    Second :3d\n",
    ),
    operation: {
      kind: "addTask",
      sectionIndex: 0,
      name: "Inserted",
      id: "i1",
      start: { kind: "date", text: "2024-06-01" },
      end: { kind: "duration", text: "10d" },
    },
    refusal: "implicitStart",
    victim: "Second",
  },
  {
    name: "renaming an id without its references leaves them pointing nowhere",
    source: REFERENCE,
    naive: REFERENCE.replace("Spec :done, des1,", "Spec :done, kickoff,"),
    operation: { kind: "setTaskId", target: task(0, "Spec"), id: "kickoff" },
    refusal: "",
    victim: "Review",
  },
  {
    name: "deleting a referred task leaves a reference to nowhere",
    source: REFERENCE,
    naive: REFERENCE.replace("    Spec :done, des1, 2024-01-01, 3d\n", ""),
    operation: { kind: "deleteTask", target: task(0, "Spec") },
    refusal: "danglingReference",
    victim: "Review",
  },
  {
    name: "moving a tag behind the id makes a fourth field",
    source: REFERENCE,
    naive: REFERENCE.replace(
      "Test :b2, after b1, 3d",
      "Test :b2, after b1, 3d, done",
    ),
    operation: {
      kind: "setStatusTags",
      target: task(3, "Test"),
      tags: ["done"],
    },
    refusal: "",
    victim: "Test",
  },
];

describe("gantt operations against mermaid 12.1.0: why a plain edit is not enough", () => {
  for (const naive of NAIVE_EDITS) {
    it(
      naive.name,
      async () => {
        const before = await drawnDates(naive.source);
        const after = await drawnDates(naive.naive);
        expect(typeof before === "string" ? before : "").toBe("");
        if (typeof after === "string") {
          // Mermaid cannot draw the naive text at all.
          expect(after).toMatch(/fails|rejects|compile/);
        } else {
          expect(after.get(naive.victim)).not.toBe(
            (before as Map<string, string>).get(naive.victim),
          );
        }
        const planned = plan(naive.source, naive.operation);
        if (naive.refusal !== "") {
          expect(typeof planned === "string" ? planned : "planned").toContain(
            naive.refusal,
          );
        } else {
          // The editor does the same intent in a way Mermaid reads as promised.
          expect(typeof planned === "string" ? planned : "").toBe("");
          const { text, expected } = planned as Planned;
          expect(await mermaidAgrees(text, expected)).toEqual({
            agrees: true,
            detail: "",
          });
        }
      },
      TEST_TIMEOUT_MS,
    );
  }
});

interface SequenceCounts {
  readonly charts: number;
  readonly steps: number;
  readonly planned: number;
  readonly refused: number;
  readonly noOperation: number;
  readonly plannedByKind: Readonly<Record<string, number>>;
}

// Fixed on purpose: when the editor, the generator or Mermaid changes, the numbers move.
// Update them only after looking at why.
const EXPECTED_SEQUENCE_COUNTS: SequenceCounts = {
  charts: 199,
  steps: 1194,
  planned: 743,
  refused: 275,
  noOperation: 176,
  plannedByKind: {
    addSection: 90,
    addTask: 81,
    clearTitle: 16,
    deleteSection: 48,
    deleteTask: 85,
    renameSection: 62,
    renameTask: 57,
    setDuration: 62,
    setEnd: 45,
    setStart: 29,
    setStatusTags: 52,
    setTaskId: 55,
    setTitle: 61,
  },
};

async function editableStartingCharts(): Promise<readonly GanttCorpusCase[]> {
  const corpus = loadGanttCorpus();
  const seen = new Set<string>();
  const charts: GanttCorpusCase[] = [
    { id: "reference", group: "own", source: REFERENCE, note: "" },
    { id: "implicit", group: "own", source: IMPLICIT, note: "" },
  ];
  for (const entry of [...corpus.cases, ...loadGuiGanttCases()]) {
    if (!ganttEditability(parseGantt(entry.source)).editable) continue;
    if (seen.has(entry.source)) continue;
    seen.add(entry.source);
    charts.push(entry);
  }
  return charts;
}

describe("gantt operations against mermaid 12.1.0: random operation sequences", () => {
  it(
    "every plan is refused or reads back, in mermaid, exactly as promised",
    async () => {
      const random = seededRandom(SEQUENCE_SEED);
      const charts = await editableStartingCharts();
      for (const chart of charts) rememberGanttIds(chart.source);
      const problems: string[] = [];
      const plannedByKind: Record<string, number> = {};
      let steps = 0;
      let planned = 0;
      let refused = 0;
      let noOperation = 0;
      for (const chart of charts) {
        let source = chart.source;
        for (let step = 0; step < STEPS_PER_SEQUENCE; step += 1) {
          steps += 1;
          const operation = randomGanttOperation(source, random);
          if (operation === null) {
            noOperation += 1;
            continue;
          }
          const result = planGanttOperation(source, operation);
          if (!result.ok) {
            refused += 1;
            if (result.error.kind === "diagramNotEditable") {
              problems.push(
                `${chart.id} step ${step}: source stopped being editable: ${result.error.detail}`,
              );
            }
            continue;
          }
          const applied = applyTextEdits(source, result.value.edits);
          if (!applied.ok) {
            problems.push(`${chart.id} step ${step}: ${applied.error.detail}`);
            continue;
          }
          const verdict = verifyGanttCandidate(
            applied.value.text,
            result.value.expected,
          );
          if (!verdict.ok) {
            problems.push(
              `${chart.id} step ${step} ${operation.kind}: verify ${verdict.error.detail}\n${JSON.stringify(operation)}\n${applied.value.text}`,
            );
            continue;
          }
          planned += 1;
          plannedByKind[operation.kind] =
            (plannedByKind[operation.kind] ?? 0) + 1;
          const agreement = await mermaidAgrees(
            applied.value.text,
            result.value.expected,
          );
          if (!agreement.agrees) {
            problems.push(
              `${chart.id} step ${step} ${operation.kind}: ${agreement.detail}\n${JSON.stringify(operation)}\n${applied.value.text}`,
            );
            break;
          }
          source = applied.value.text;
        }
      }
      expect(problems).toEqual([]);
      const counts: SequenceCounts = {
        charts: charts.length,
        steps,
        planned,
        refused,
        noOperation,
        plannedByKind: Object.fromEntries(
          Object.entries(plannedByKind).sort(([a], [b]) => a.localeCompare(b)),
        ),
      };
      expect(
        counts,
        "counts changed (editor, generator or mermaid differs from the recorded run)",
      ).toEqual(EXPECTED_SEQUENCE_COUNTS);
    },
    TEST_TIMEOUT_MS,
  );
});
