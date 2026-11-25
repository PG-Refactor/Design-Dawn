import { describe, expect, it } from "vitest";
import {
  checkGanttMeaning,
  findMeaningProblem,
  type GanttMeaning,
  ganttMeaningOf,
  resolveGanttSchedule,
} from "./gantt-meaning";
import { parseGantt } from "./gantt-parser";

const gantt = (body: string) => `gantt\n    dateFormat YYYY-MM-DD\n${body}\n`;

function meaningOf(source: string): GanttMeaning {
  const meaning = ganttMeaningOf(parseGantt(source));
  if (meaning === null) throw new Error("no meaning");
  return meaning;
}

describe("the schedule", () => {
  it("has no dates for tasks that wait on each other, an unknown id or nothing", () => {
    const schedule = resolveGanttSchedule(
      meaningOf(
        gantt(
          "    section S\n    A :a, after b, 1d\n    B :b, after a, 1d\n    C :c, after x, 1d\n    D :d, 2026-01-01, until x",
        ),
      ),
    );
    expect(schedule).toEqual([null, null, null, null]);
  });

  it("starts a task right after the one before, ends one at the first start it waits for", () => {
    const schedule = resolveGanttSchedule(
      meaningOf(
        gantt(
          "    section S\n    A :a, 2026-01-03, 2026-01-05\n    B :1d\n    C :c, 2026-01-01, until a",
        ),
      ),
    );
    expect(schedule[1]?.start).toBe(schedule[0]?.end);
    expect(schedule[2]?.end).toBe(schedule[0]?.start);
  });

  it("has no start for a first task without one", () => {
    expect(resolveGanttSchedule(meaningOf(gantt("    A : 1d")))[0]).toBeNull();
  });
});

describe("problems of a meaning", () => {
  const base = meaningOf(gantt("    section S\n    A :a, 2026-01-01, 1d"));
  const [task] = base.tasks;
  if (task === undefined) throw new Error("no task");

  it.each<[string, GanttMeaning, string]>([
    [
      "two tasks with one id",
      { ...base, tasks: [task, task] },
      "duplicateTaskIds",
    ],
    [
      "two sections with one name",
      { ...base, sections: ["S", "S"] },
      "duplicateSectionNames",
    ],
    [
      "a first task without a start",
      { ...base, tasks: [{ ...task, start: { kind: "implicit" } }] },
      "firstTaskImplicitStart",
    ],
  ])("finds %s", (_what, meaning, code) => {
    expect(findMeaningProblem(meaning)?.code).toBe(code);
  });
});

describe("checking a candidate", () => {
  const source = gantt(
    "    title Plan\n    section S\n    A :a, 2026-01-01, 1d\n    B :b, after a, 1d",
  );
  const expected = meaningOf(source);
  const parsed = parseGantt(source);

  it("accepts the same meaning", () => {
    expect(checkGanttMeaning(parsed, expected).ok).toBe(true);
  });

  it.each<[string, GanttMeaning]>([
    ["another title", { ...expected, title: "Other" }],
    ["another date format", { ...expected, dateFormat: "DD/MM/YYYY" }],
    ["other sections", { ...expected, sections: ["T"] }],
    [
      "another number of tasks",
      { ...expected, tasks: expected.tasks.slice(1) },
    ],
    [
      "other links",
      { ...expected, links: [{ id: "a", url: "https://x.example" }] },
    ],
    [
      "other settings",
      { ...expected, settings: [{ keyword: "excludes", value: "weekends" }] },
    ],
  ])("refuses %s", (_what, meaning) => {
    const result = checkGanttMeaning(parsed, meaning);
    expect(!result.ok && result.error.kind).toBe("diagramMeaningMismatch");
  });

  it("refuses a candidate with no meaning", () => {
    const result = checkGanttMeaning(
      parseGantt("gantt\n    A : 1d\n"),
      expected,
    );
    expect(result.ok).toBe(false);
  });
});

describe("more of the meaning", () => {
  it("has no end for a task that waits for one without a start", () => {
    const schedule = resolveGanttSchedule(
      meaningOf(gantt("    A :a, after x, 1d\n    B :b, 2026-01-01, until a")),
    );
    expect(schedule[1]).toBeNull();
  });

  it("refuses a candidate whose schedule is not the promised one", () => {
    const source = gantt("    A :a, 2026-01-01, 1d");
    const expected = { ...meaningOf(source), schedule: [null] };
    const result = checkGanttMeaning(parseGantt(source), expected);
    expect(!result.ok && result.error.kind).toBe("diagramMeaningMismatch");
  });
});
