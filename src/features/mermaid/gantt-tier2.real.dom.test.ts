// @vitest-environment jsdom
// The Tier 2 gantt operations (docs/architecture.md §16.17.2) against the real Mermaid 12.1.0:
// fixed cases for every operation, and seeded random operation sequences that mix Tier 1 and
// Tier 2 operations on every editable chart of the corpus. For every plan that is handed out
// Mermaid itself must accept the new text, read it as the promised meaning, compute the dates
// the editor predicted (and, for moves and copies, the same dates as before), the app must be
// able to draw it, and the edits must be undoable to the exact old text.
import { beforeAll, describe, expect, it } from "vitest";
import { ganttEditability } from "../../domain/diagram/gantt/gantt-editability";
import {
  type GanttOperation,
  planGanttOperation,
} from "../../domain/diagram/gantt/gantt-operations";
import { parseGantt } from "../../domain/diagram/gantt/gantt-parser";
import { applyTextEdits } from "../../domain/diagram/text-edit";
import { seededRandom } from "./test-support/flowchart-generator";
import {
  type GanttCorpusCase,
  loadGanttCorpus,
  loadGuiGanttCases,
} from "./test-support/gantt-corpus";
import { checkGanttPlanAgainstMermaid } from "./test-support/gantt-plan-check";
import { randomGanttTier2Operation } from "./test-support/gantt-tier2-operation-generator";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";
import { rememberGanttIds } from "./test-support/mermaid-gantt-db";

beforeAll(installFakeSvgMeasurement);

const TEST_TIMEOUT_MS = 600_000;
const SEQUENCE_SEED = 9191;
const STEPS_PER_SEQUENCE = 6;

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
const WEEK = `gantt
    dateFormat YYYY-MM-DD
    section A
    Build :b1, 2024-01-05, 3d
    Test :b2, after b1, 2d
    Next :4d
    Ship :2024-01-20, 2024-01-22
`;
const CLICKS = `gantt
    dateFormat YYYY-MM-DD
    section A
    One :a1, 2024-01-01, 2d
    click a1 href "https://one.example/"
    Two :a2, 2024-01-05, 2d
    Three :a3, 2024-01-09, 3d
    click a2,a3 href "https://two.example/"
    Four :3d
    section B
    Five :a5, 2024-02-01, 2d
`;
const TIMED = `gantt
    dateFormat YYYY-MM-DD HH:mm
    excludes weekends
    section A
    Early :e1, 2024-01-05 09:00, 6h
    Late :after e1, 30h
    Last :2d
`;

const task = (index: number, name: string) => ({ index, name });
const section = (index: number, name: string) => ({ index, name });

interface Case {
  readonly label: string;
  readonly source: string;
  readonly operation: GanttOperation;
  // Planned (default) or the reason it is refused with.
  readonly refusal?: string;
}

const CASES: readonly Case[] = [
  {
    label: "swap two dated tasks",
    source: REFERENCE,
    operation: { kind: "moveTask", target: task(0, "Spec"), direction: "down" },
  },
  {
    label: "move an implicit chain down (freezes)",
    source: IMPLICIT,
    operation: {
      kind: "moveTask",
      target: task(1, "Second"),
      direction: "down",
    },
  },
  {
    label: "move the first task down (freezes two)",
    source: IMPLICIT,
    operation: {
      kind: "moveTask",
      target: task(0, "First"),
      direction: "down",
    },
  },
  {
    label: "move up with its click",
    source: CLICKS,
    operation: { kind: "moveTask", target: task(1, "Two"), direction: "up" },
  },
  {
    label: "move to another section",
    source: IMPLICIT,
    operation: {
      kind: "moveTaskToSection",
      target: task(2, "Third"),
      sectionIndex: 1,
    },
  },
  {
    label: "move a linked task to another section",
    source: CLICKS,
    operation: {
      kind: "moveTaskToSection",
      target: task(0, "One"),
      sectionIndex: 1,
    },
  },
  {
    label: "swap sections",
    source: IMPLICIT,
    operation: {
      kind: "moveSection",
      target: section(0, "A"),
      direction: "down",
    },
  },
  {
    label: "swap sections with a shared click",
    source: CLICKS,
    operation: {
      kind: "moveSection",
      target: section(1, "B"),
      direction: "up",
    },
  },
  {
    label: "duplicate a dated task",
    source: REFERENCE,
    operation: { kind: "duplicateTask", target: task(1, "Review") },
  },
  {
    label: "duplicate before an implicit task",
    source: IMPLICIT,
    operation: { kind: "duplicateTask", target: task(0, "First") },
  },
  {
    label: "duplicate a linked task",
    source: CLICKS,
    operation: { kind: "duplicateTask", target: task(0, "One") },
  },
  {
    label: "set the axis format",
    source: REFERENCE,
    operation: { kind: "setAxisFormat", format: "%Y-%m-%d (%b)" },
  },
  {
    label: "exclude weekends",
    source: WEEK,
    operation: { kind: "setExcludes", tokens: ["weekends"] },
  },
  {
    label: "exclude weekdays and a date",
    source: WEEK,
    operation: { kind: "setExcludes", tokens: ["monday", "2024-01-09"] },
  },
  {
    label: "exclude weekends in a chart with hours",
    source: TIMED.replace("    excludes weekends\n", ""),
    operation: { kind: "setExcludes", tokens: ["weekends"] },
  },
  {
    label: "change excludes in a chart with hours",
    source: TIMED,
    operation: { kind: "setExcludes", tokens: ["saturday"] },
  },
  {
    label: "clear excludes",
    source: TIMED,
    operation: { kind: "clearExcludes" },
  },
  {
    label: "add a link",
    source: REFERENCE,
    operation: {
      kind: "addLink",
      target: task(2, "Code"),
      url: "https://example.com/spec?id=1&x=2",
    },
  },
  {
    label: "remove a link",
    source: IMPLICIT,
    operation: { kind: "removeLink", target: task(3, "Other") },
  },
  {
    label: "remove one link of a list",
    source: CLICKS,
    operation: { kind: "removeLink", target: task(1, "Two") },
  },
  {
    label: "a move that cannot freeze is refused",
    source:
      "gantt\n    dateFormat YYYY-MM-DD\n    A :a1, 2024-01-01, 1M\n    B :2d\n    C :2d\n",
    operation: { kind: "moveTask", target: task(1, "B"), direction: "down" },
    refusal: "cannotFreeze",
  },
  {
    label: "excludes with an unknown duration is refused",
    source: "gantt\n    dateFormat YYYY-MM-DD\n    A :a1, 2024-01-01, 1M\n",
    operation: { kind: "setExcludes", tokens: ["weekends"] },
    refusal: "unknownDates",
  },
];

describe("gantt Tier 2 operations against mermaid 12.1.0: fixed cases", () => {
  for (const entry of CASES) {
    it(
      entry.label,
      async () => {
        rememberGanttIds(entry.source);
        const plan = planGanttOperation(entry.source, entry.operation);
        if (entry.refusal !== undefined) {
          expect(plan.ok ? "planned" : plan.error.detail).toContain(
            entry.refusal,
          );
          return;
        }
        expect(plan.ok ? "" : plan.error.detail).toBe("");
        expect(
          await checkGanttPlanAgainstMermaid(
            entry.label,
            entry.source,
            entry.operation,
          ),
        ).toBeNull();
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
  charts: 202,
  steps: 1212,
  planned: 545,
  refused: 593,
  noOperation: 74,
  plannedByKind: {
    addLink: 41,
    addSection: 29,
    addTask: 37,
    clearExcludes: 8,
    clearTitle: 7,
    deleteSection: 18,
    deleteTask: 32,
    duplicateTask: 34,
    moveSection: 19,
    moveTask: 43,
    moveTaskToSection: 22,
    removeLink: 7,
    renameSection: 18,
    renameTask: 13,
    setAxisFormat: 62,
    setDuration: 14,
    setEnd: 9,
    setExcludes: 52,
    setStart: 10,
    setStatusTags: 28,
    setTaskId: 15,
    setTitle: 27,
  },
};

async function editableStartingCharts(): Promise<readonly GanttCorpusCase[]> {
  const seen = new Set<string>();
  const charts: GanttCorpusCase[] = [
    ...[REFERENCE, IMPLICIT, WEEK, CLICKS, TIMED].map(
      (source, index): GanttCorpusCase => ({
        id: `own${index}`,
        group: "own",
        source,
        note: "",
      }),
    ),
  ];
  for (const entry of [...loadGanttCorpus().cases, ...loadGuiGanttCases()]) {
    if (!ganttEditability(parseGantt(entry.source)).editable) continue;
    if (seen.has(entry.source)) continue;
    seen.add(entry.source);
    charts.push(entry);
  }
  return charts;
}

describe("gantt Tier 2 operations against mermaid 12.1.0: random operation sequences", () => {
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
          const operation = randomGanttTier2Operation(source, random);
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
          const label = `${chart.id} step ${step} ${operation.kind} ${JSON.stringify(operation)}`;
          const problem = await checkGanttPlanAgainstMermaid(
            label,
            source,
            operation,
          );
          if (problem !== null) {
            problems.push(problem);
            break;
          }
          planned += 1;
          plannedByKind[operation.kind] =
            (plannedByKind[operation.kind] ?? 0) + 1;
          const applied = applyTextEdits(source, result.value.edits);
          if (applied.ok) source = applied.value.text;
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
