import { describe, expect, it } from "vitest";
import { applyTextEdits } from "../text-edit";
import { ganttExcludeTokensOf } from "./gantt-input";
import { type GanttOperation, planGanttOperation } from "./gantt-operations";

const gantt = (body: string) => `gantt\n    dateFormat YYYY-MM-DD\n${body}\n`;

function run(source: string, operation: GanttOperation): string {
  const plan = planGanttOperation(source, operation);
  if (!plan.ok) throw new Error(`refused: ${plan.error.detail}`);
  const applied = applyTextEdits(source, plan.value.edits);
  if (!applied.ok) throw new Error(applied.error.detail);
  return applied.value.text;
}

function refusal(source: string, operation: GanttOperation): string {
  const plan = planGanttOperation(source, operation);
  return plan.ok ? "" : plan.error.detail;
}

const CHART = gantt(
  '    section S\n    A :a, 2026-01-01, 1d\n    B :b, after a, 1d\n    click a href "https://a.example"\n    click b href "https://b.example"',
);

describe("titles and sections", () => {
  it("does not clear one of several titles", () => {
    expect(
      refusal(gantt("    title One\n    title Two\n    A :a, 2026-01-01, 1d"), {
        kind: "clearTitle",
      }),
    ).toContain("multipleTitles");
  });

  it("renames a section to the same name without edits, and refuses a bad name", () => {
    const plan = planGanttOperation(CHART, {
      kind: "renameSection",
      target: { index: 0, name: "S" },
      name: "S",
    });
    expect(plan.ok && plan.value.edits).toEqual([]);
    expect(
      refusal(CHART, {
        kind: "renameSection",
        target: { index: 0, name: "S" },
        name: "a;b",
      }),
    ).not.toBe("");
  });

  it("refuses to delete a section that is not there", () => {
    expect(
      refusal(CHART, {
        kind: "deleteSection",
        target: { index: 4, name: "Z" },
      }),
    ).toContain("targetNotFound");
  });
});

describe("tasks", () => {
  it("renames the references to a task whose id changes", () => {
    expect(
      run(CHART, {
        kind: "setTaskId",
        target: { index: 0, name: "A" },
        id: "x",
      }),
    ).toContain("B :b, after x, 1d");
  });

  it("keeps the text when the start or end does not change", () => {
    const start = planGanttOperation(CHART, {
      kind: "setStart",
      target: { index: 0, name: "A" },
      start: { kind: "date", text: "2026-01-01" },
    });
    expect(start.ok && start.value.edits).toEqual([]);
    const end = planGanttOperation(CHART, {
      kind: "setEnd",
      target: { index: 0, name: "A" },
      end: { kind: "duration", text: "1d" },
    });
    expect(end.ok && end.value.edits).toEqual([]);
  });

  it("refuses a name with a control character and a link without a host", () => {
    expect(
      refusal(CHART, {
        kind: "renameTask",
        target: { index: 0, name: "A" },
        name: "A\u0001",
      }),
    ).not.toBe("");
    expect(
      refusal(CHART, {
        kind: "addLink",
        target: { index: 0, name: "A" },
        url: "https://[",
      }),
    ).toContain("invalidUrl");
  });
});

describe("links", () => {
  it("removes the link of a task below other links", () => {
    expect(
      run(CHART, { kind: "removeLink", target: { index: 1, name: "B" } }),
    ).not.toContain("b.example");
  });
});

describe("exclude tokens", () => {
  it("splits on blanks and commas, dropping empty pieces", () => {
    expect(ganttExcludeTokensOf(" weekends, 2026-01-01  sunday ")).toEqual([
      "weekends",
      "2026-01-01",
      "sunday",
    ]);
  });
});

describe("more task edits", () => {
  it("renames a task to its own name without edits", () => {
    const plan = planGanttOperation(CHART, {
      kind: "renameTask",
      target: { index: 0, name: "A" },
      name: "A",
    });
    expect(plan.ok && plan.value.edits).toEqual([]);
  });

  it("renames only the reference that names the task", () => {
    const source = gantt(
      "    A :a, 2026-01-01, 1d\n    B :b, 2026-01-01, 1d\n    C :c, after a b, until a",
    );
    const result = run(source, {
      kind: "setTaskId",
      target: { index: 0, name: "A" },
      id: "x",
    });
    expect(result).toContain("C :c, after x b, until x");
  });

  it("gives a title the default indentation in a chart with nothing but its settings", () => {
    const result = run("gantt\ndateFormat YYYY-MM-DD\n", {
      kind: "setTitle",
      title: "T",
    });
    expect(result).toContain("title T");
  });

  it("puts a title before the first content line", () => {
    expect(
      run(gantt("    A :a, 2026-01-01, 1d"), { kind: "setTitle", title: "T" }),
    ).toContain("title T");
  });
});
