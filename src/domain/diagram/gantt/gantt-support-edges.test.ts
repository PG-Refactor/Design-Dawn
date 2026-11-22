import { describe, expect, it } from "vitest";
import { ganttMeaningOf } from "./gantt-meaning";
import {
  readBack,
  regionEnd,
  resolveSectionTarget,
  resolveTask,
} from "./gantt-operation-support";
import { parseGantt } from "./gantt-parser";
import { readGanttView } from "./gantt-view";

const SOURCE =
  "gantt\n    dateFormat YYYY-MM-DD\n    section S\n    A :a, 2026-01-01, 1d\n\n    %% note\n    section T\n    B :b, 2026-01-02, 1d\n";

describe("targets and regions", () => {
  const parsed = parseGantt(SOURCE);

  it("refuses an index that is not a whole number", () => {
    expect(resolveTask(parsed, { index: 0.5, name: "A" }).ok).toBe(false);
    expect(resolveSectionTarget(parsed, { index: 0.5, name: "S" }).ok).toBe(
      false,
    );
  });

  it("ends a section's region at its last task, before blank and comment lines", () => {
    expect(regionEnd(parsed, 0)).toBe(3);
  });
});

describe("reading back", () => {
  const meaning = ganttMeaningOf(parseGantt(SOURCE));
  if (meaning === null) throw new Error("no meaning");

  it("refuses edits that cannot be applied, and a text that means something else", () => {
    const overlapping = readBack(
      SOURCE,
      [
        { start: 0, end: 4, text: "" },
        { start: 2, end: 6, text: "" },
      ],
      meaning,
    );
    expect(!overlapping.ok && overlapping.error.detail).toContain(
      "invalidEdits",
    );
    const other = readBack(SOURCE, [], { ...meaning, title: "Other" });
    expect(!other.ok && other.error.detail).toContain("unreadableResult");
  });
});

describe("the view", () => {
  it("probes with an id no task has", () => {
    const view = readGanttView(
      "gantt\n    dateFormat YYYY-MM-DD\n    A :gtprobe, 2026-01-01, 1d\n",
    );
    expect(view?.tasks[0]?.id).toBe("gtprobe");
  });
});
