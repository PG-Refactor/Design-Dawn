import { describe, expect, it } from "vitest";
import { type GanttOperation, planGanttOperation } from "./gantt-operations";

const READABLE =
  "gantt\n    dateFormat YYYY-MM-DD\n    section S\n    A :a, 2026-01-01, 1d\n";
// No dateFormat: not a chart the editor can edit.
const UNREADABLE = "gantt\n    A :a, 2026-01-01, 1d\n";

const TASK = { index: 0, name: "A" };
const MISSING_TASK = { index: 7, name: "Z" };
const SECTION = { index: 0, name: "S" };

const TASK_OPERATIONS = (target: typeof TASK): readonly GanttOperation[] => [
  { kind: "renameTask", target, name: "B" },
  { kind: "setTaskId", target, id: "b" },
  { kind: "setStart", target, start: { kind: "date", text: "2026-01-02" } },
  { kind: "setDuration", target, duration: "2d" },
  { kind: "setEnd", target, end: { kind: "duration", text: "2d" } },
  { kind: "setStatusTags", target, tags: ["done"] },
  { kind: "deleteTask", target },
  { kind: "moveTask", target, direction: "down" },
  { kind: "moveTaskToSection", target, sectionIndex: 0 },
  { kind: "duplicateTask", target },
  { kind: "addLink", target, url: "https://x.example" },
  { kind: "removeLink", target },
];

const OPERATIONS: readonly GanttOperation[] = [
  { kind: "setTitle", title: "T" },
  { kind: "clearTitle" },
  { kind: "addSection", name: "N" },
  { kind: "renameSection", target: SECTION, name: "N" },
  { kind: "deleteSection", target: SECTION },
  {
    kind: "addTask",
    name: "B",
    start: { kind: "date", text: "2026-01-02" },
    end: { kind: "duration", text: "1d" },
  },
  { kind: "moveSection", target: SECTION, direction: "down" },
  { kind: "setAxisFormat", format: "%d" },
  { kind: "setExcludes", tokens: ["weekends"] },
  { kind: "clearExcludes" },
  ...TASK_OPERATIONS(TASK),
];

describe("every Gantt operation", () => {
  it.each(OPERATIONS.map((operation) => [operation.kind, operation] as const))(
    "%s refuses a chart it cannot edit",
    (_kind, operation) => {
      const plan = planGanttOperation(UNREADABLE, operation);
      expect(!plan.ok && plan.error.kind).toBe("diagramNotEditable");
    },
  );

  it.each(
    TASK_OPERATIONS(MISSING_TASK).map(
      (operation) => [operation.kind, operation] as const,
    ),
  )("%s refuses a task that is not there", (_kind, operation) => {
    const plan = planGanttOperation(READABLE, operation);
    expect(!plan.ok && plan.error.detail).toContain("targetNotFound");
  });
});
