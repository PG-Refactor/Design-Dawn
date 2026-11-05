import { describe, expect, it } from "vitest";
import { applyTextEdits, type TextEdit } from "../text-edit";
import {
  GANTT_AXIS_FORMAT_MAX_LENGTH,
  GANTT_LINK_URL_MAX_LENGTH,
} from "./gantt-config";
import { ganttMeaningOf, resolveGanttSchedule } from "./gantt-meaning";
import {
  type GanttOperation,
  planGanttOperation,
  verifyGanttCandidate,
} from "./gantt-operations";
import { parseGantt } from "./gantt-parser";

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

const task = (index: number, name: string) => ({ index, name });
const section = (index: number, name: string) => ({ index, name });

// The exact inverse of a set of edits applied to `source`.
function invert(source: string, edits: readonly TextEdit[]): TextEdit[] {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let delta = 0;
  return sorted.map((edit) => {
    const start = edit.start + delta;
    delta += edit.text.length - (edit.end - edit.start);
    return {
      start,
      end: start + edit.text.length,
      text: source.slice(edit.start, edit.end),
    };
  });
}

interface Done {
  readonly text: string;
  readonly frozen: readonly number[];
}

// Plans, applies, proves and undoes one operation.
function run(source: string, operation: GanttOperation): Done {
  const plan = planGanttOperation(source, operation);
  if (!plan.ok) throw new Error(`refused: ${plan.error.detail}`);
  const applied = applyTextEdits(source, plan.value.edits);
  if (!applied.ok) throw new Error(`edits: ${applied.error.detail}`);
  const verdict = verifyGanttCandidate(applied.value.text, plan.value.expected);
  if (!verdict.ok) throw new Error(`verify: ${verdict.error.detail}`);
  const undone = applyTextEdits(
    applied.value.text,
    invert(source, plan.value.edits),
  );
  expect(undone.ok && undone.value.text).toBe(source);
  return { text: applied.value.text, frozen: plan.value.frozenTasks ?? [] };
}

function refusal(source: string, operation: GanttOperation): string {
  const plan = planGanttOperation(source, operation);
  if (plan.ok) throw new Error("expected a refusal");
  return plan.error.detail;
}

function scheduleByName(source: string): Map<string, string> {
  const meaning = ganttMeaningOf(parseGantt(source));
  if (meaning === null) throw new Error("no meaning");
  const schedule = resolveGanttSchedule(meaning);
  return new Map(
    meaning.tasks.map((entry, index) => [
      entry.name,
      JSON.stringify(schedule[index]),
    ]),
  );
}

function expectSameDates(before: string, after: string) {
  expect(scheduleByName(after)).toEqual(scheduleByName(before));
}

describe("moveTask", () => {
  it("swaps two tasks that all have a date of their own", () => {
    const { text, frozen } = run(REFERENCE, {
      kind: "moveTask",
      target: task(1, "Review"),
      direction: "up",
    });
    // The moved tasks and their neighbours are written in the new order; nothing else changes.
    expect(text).toBe(
      REFERENCE.replace(
        "    Spec :done, des1, 2024-01-01, 3d\n    Review :active, des2, after des1, 2d\n",
        "    Review :active, des2, after des1, 2d\n    Spec :done, des1, 2024-01-01, 3d\n",
      ),
    );
    expect(frozen).toEqual([]);
    expectSameDates(REFERENCE, text);
  });

  it("freezes the implicit starts that would get another predecessor", () => {
    const { text, frozen } = run(IMPLICIT, {
      kind: "moveTask",
      target: task(0, "First"),
      direction: "down",
    });
    expect(text).toBe(
      IMPLICIT.replace(
        "    First :2024-01-01, 2d\n    Second :3d\n    Third :2d\n",
        "    Second :2024-01-03, 3d\n    First :2024-01-01, 2d\n    Third :2024-01-06, 2d\n",
      ),
    );
    expect(frozen).toEqual([1, 2]);
    expectSameDates(IMPLICIT, text);
  });

  it("moves a task up and down within its section only, with its click line", () => {
    const chart = `gantt
    dateFormat YYYY-MM-DD
    section A
    One :a1, 2024-01-01, 2d
    click a1 href "https://one.example/"
    Two :a2, 2024-01-05, 2d
    section B
    Three :a3, 2024-02-01, 2d
`;
    const { text } = run(chart, {
      kind: "moveTask",
      target: task(0, "One"),
      direction: "down",
    });
    expect(text).toBe(
      chart.replace(
        '    One :a1, 2024-01-01, 2d\n    click a1 href "https://one.example/"\n    Two :a2, 2024-01-05, 2d\n',
        '    Two :a2, 2024-01-05, 2d\n    One :a1, 2024-01-01, 2d\n    click a1 href "https://one.example/"\n',
      ),
    );
    expect(
      refusal(chart, {
        kind: "moveTask",
        target: task(1, "Two"),
        direction: "down",
      }),
    ).toContain("atBoundary");
    expect(
      refusal(chart, {
        kind: "moveTask",
        target: task(0, "One"),
        direction: "up",
      }),
    ).toContain("atBoundary");
  });

  it("keeps comments and blank lines where they are", () => {
    const chart = `gantt
    dateFormat YYYY-MM-DD
    One :a1, 2024-01-01, 2d
    %% note
    Two :a2, 2024-01-05, 2d

    Three :a3, 2024-01-09, 1d
`;
    const { text } = run(chart, {
      kind: "moveTask",
      target: task(2, "Three"),
      direction: "up",
    });
    expect(text).toBe(
      chart.replace(
        "    Two :a2, 2024-01-05, 2d\n\n    Three :a3, 2024-01-09, 1d\n",
        "    Three :a3, 2024-01-09, 1d\n\n    Two :a2, 2024-01-05, 2d\n",
      ),
    );
  });

  it("refuses when the start cannot be computed to freeze it", () => {
    const chart = `gantt
    dateFormat YYYY-MM-DD
    One :a1, 2024-01-01, 1M
    Two :3d
    Three :4d
`;
    const reason = refusal(chart, {
      kind: "moveTask",
      target: task(1, "Two"),
      direction: "down",
    });
    expect(reason).toContain("cannotFreeze");
    expect(reason).toContain("fix its start");
  });

  it("refuses to separate a click from its task, and a stale or unknown target", () => {
    // The comment keeps the click from travelling with its task.
    const chart = `gantt
    dateFormat YYYY-MM-DD
    One :a1, 2024-01-01, 2d
    %% links
    click a1 href "https://one.example/"
    Two :a2, 2024-01-05, 2d
`;
    expect(
      refusal(chart, {
        kind: "moveTask",
        target: task(0, "One"),
        direction: "down",
      }),
    ).toContain("clickLink");
    expect(
      refusal(chart, {
        kind: "moveTask",
        target: task(1, "Nope"),
        direction: "up",
      }),
    ).toContain("targetMismatch");
    expect(
      refusal(chart, {
        kind: "moveTask",
        target: task(9, "Two"),
        direction: "up",
      }),
    ).toContain("targetNotFound");
  });

  it("keeps the dates of tasks that depend on the moved ones", () => {
    const chart = `gantt
    dateFormat YYYY-MM-DD
    One :a1, 2024-01-01, 2d
    Two :a2, after a1, 2d
    Three :a3, after a2, 2d
    Four :2d
`;
    const { text, frozen } = run(chart, {
      kind: "moveTask",
      target: task(2, "Three"),
      direction: "up",
    });
    expectSameDates(chart, text);
    // Four started after Three and still does; Two moved down but nothing implicit follows.
    expect(frozen).toEqual([3]);
  });
});

describe("moveTaskToSection", () => {
  it("appends the task to another section, freezing what would move", () => {
    const { text, frozen } = run(IMPLICIT, {
      kind: "moveTaskToSection",
      target: task(2, "Third"),
      sectionIndex: 1,
    });
    expect(text).toBe(
      IMPLICIT.replace("    Third :2d\n", "").replace(
        '    click o1 href "https://example.com/"\n',
        '    click o1 href "https://example.com/"\n    Third :2024-01-06, 2d\n',
      ),
    );
    expect(frozen).toEqual([2]);
    expectSameDates(IMPLICIT, text);
  });

  it("moves a task with its click line, into an empty section too", () => {
    const { text } = run(IMPLICIT, {
      kind: "moveTaskToSection",
      target: task(3, "Other"),
      sectionIndex: 0,
    });
    expect(text).toBe(`gantt
    dateFormat YYYY-MM-DD
    section A
    First :2024-01-01, 2d
    Second :3d
    Third :2d
    Other :o1, 2024-02-01, 5d
    click o1 href "https://example.com/"
    section B
`);
    const empty = `${REFERENCE}    section Ship\n`;
    const moved = run(empty, {
      kind: "moveTaskToSection",
      target: task(4, "Release"),
      sectionIndex: 2,
    });
    expect(moved.text).toBe(
      `${REFERENCE.replace("    Release :milestone, m1, after b2, 0d\n", "")}    section Ship\n    Release :milestone, m1, after b2, 0d\n`,
    );
  });

  it("works from before the first section", () => {
    const chart = `gantt
    dateFormat YYYY-MM-DD
    Loose :l1, 2024-01-01, 1d
    section A
    One :a1, 2024-01-05, 1d
`;
    const { text } = run(chart, {
      kind: "moveTaskToSection",
      target: task(0, "Loose"),
      sectionIndex: 0,
    });
    expect(text).toBe(`gantt
    dateFormat YYYY-MM-DD
    section A
    One :a1, 2024-01-05, 1d
    Loose :l1, 2024-01-01, 1d
`);
  });

  it("refuses the same section, a missing section and an uncomputable freeze", () => {
    expect(
      refusal(IMPLICIT, {
        kind: "moveTaskToSection",
        target: task(0, "First"),
        sectionIndex: 0,
      }),
    ).toContain("sameSection");
    expect(
      refusal(IMPLICIT, {
        kind: "moveTaskToSection",
        target: task(0, "First"),
        sectionIndex: 5,
      }),
    ).toContain("invalidIndex");
    const monthly = `gantt
    dateFormat YYYY-MM-DD
    section A
    One :a1, 2024-01-01, 1y
    Two :3d
    section B
    Three :b1, 2024-05-01, 1d
`;
    expect(
      refusal(monthly, {
        kind: "moveTaskToSection",
        target: task(1, "Two"),
        sectionIndex: 1,
      }),
    ).toContain("cannotFreeze");
  });

  it("refuses to leave a click line above its task", () => {
    const chart = `gantt
    dateFormat YYYY-MM-DD
    section A
    One :a1, 2024-01-01, 2d
    Two :a2, 2024-01-05, 2d
    click a1,a2 href "https://x.example/"
    section B
    Three :a3, 2024-02-01, 2d
`;
    expect(
      refusal(chart, {
        kind: "moveTaskToSection",
        target: task(0, "One"),
        sectionIndex: 1,
      }),
    ).toContain("clickLink");
  });
});

describe("moveSection", () => {
  it("swaps two sections with their tasks, comments and click lines", () => {
    const { text, frozen } = run(IMPLICIT, {
      kind: "moveSection",
      target: section(0, "A"),
      direction: "down",
    });
    expect(text).toBe(`gantt
    dateFormat YYYY-MM-DD
    section B
    Other :o1, 2024-02-01, 5d
    click o1 href "https://example.com/"
    section A
    First :2024-01-01, 2d
    Second :3d
    Third :2d
`);
    expect(frozen).toEqual([]);
    expectSameDates(IMPLICIT, text);
  });

  it("freezes the first implicit task of a section that gets a new predecessor", () => {
    const chart = `gantt
    dateFormat YYYY-MM-DD
    section A
    First :f1, 2024-01-01, 2d
    section B
    Second :3d
    section C
    Third :s3, 2024-03-01, 1d
`;
    const { text, frozen } = run(chart, {
      kind: "moveSection",
      target: section(1, "B"),
      direction: "up",
    });
    expect(text).toBe(`gantt
    dateFormat YYYY-MM-DD
    section B
    Second :2024-01-03, 3d
    section A
    First :f1, 2024-01-01, 2d
    section C
    Third :s3, 2024-03-01, 1d
`);
    expect(frozen).toEqual([1]);
    expectSameDates(chart, text);
  });

  it("refuses at the ends, for a setting inside, and when it cannot freeze", () => {
    expect(
      refusal(IMPLICIT, {
        kind: "moveSection",
        target: section(0, "A"),
        direction: "up",
      }),
    ).toContain("atBoundary");
    expect(
      refusal(IMPLICIT, {
        kind: "moveSection",
        target: section(1, "B"),
        direction: "down",
      }),
    ).toContain("atBoundary");
    const withSetting = `gantt
    dateFormat YYYY-MM-DD
    section A
    One :a1, 2024-01-01, 2d
    axisFormat %m/%d
    section B
    Two :b1, 2024-02-01, 2d
`;
    expect(
      refusal(withSetting, {
        kind: "moveSection",
        target: section(1, "B"),
        direction: "up",
      }),
    ).toContain("blockContent");
    const unknown = `gantt
    dateFormat YYYY-MM-DD
    section A
    One :a1, 2024-01-01, 1M
    section B
    Two :3d
`;
    expect(
      refusal(unknown, {
        kind: "moveSection",
        target: section(1, "B"),
        direction: "up",
      }),
    ).toContain("cannotFreeze");
    expect(
      refusal(IMPLICIT, {
        kind: "moveSection",
        target: section(0, "B"),
        direction: "down",
      }),
    ).toContain("targetMismatch");
  });

  it("keeps CRLF and a missing final line break", () => {
    const chart =
      "gantt\r\n    dateFormat YYYY-MM-DD\r\n    section A\r\n    One :a1, 2024-01-01, 2d\r\n    section B\r\n    Two :b1, 2024-02-01, 2d";
    const { text } = run(chart, {
      kind: "moveSection",
      target: section(0, "A"),
      direction: "down",
    });
    expect(text).toBe(
      "gantt\r\n    dateFormat YYYY-MM-DD\r\n    section B\r\n    Two :b1, 2024-02-01, 2d\r\n    section A\r\n    One :a1, 2024-01-01, 2d",
    );
  });
});

describe("duplicateTask", () => {
  it("copies a task below itself with a new id and leaves references on the original", () => {
    const chart = `${REFERENCE.replace("Review :active, des2, after des1, 2d", "Review :active, des2, after des1, 2d")}`;
    const { text } = run(chart, {
      kind: "duplicateTask",
      target: task(1, "Review"),
    });
    expect(text).toBe(
      chart.replace(
        "    Review :active, des2, after des1, 2d\n",
        "    Review :active, des2, after des1, 2d\n    Review :active, gt1, after des1, 2d\n",
      ),
    );
    // Code still follows des2, not the copy.
    expect(text).toContain("Code :crit, b1, after des2, 5d");
  });

  it("keeps the dates of an implicit successor, and a task without an id stays without", () => {
    const { text } = run(IMPLICIT, {
      kind: "duplicateTask",
      target: task(0, "First"),
    });
    expect(text).toBe(
      IMPLICIT.replace(
        "    First :2024-01-01, 2d\n",
        "    First :2024-01-01, 2d\n    First :2024-01-01, 2d\n",
      ),
    );
    expectSameDates(IMPLICIT, text);
  });

  it("puts the copy below the click line of the task, which is not copied", () => {
    const { text } = run(IMPLICIT, {
      kind: "duplicateTask",
      target: task(3, "Other"),
    });
    expect(text).toBe(`${IMPLICIT}    Other :gt1, 2024-02-01, 5d\n`);
  });

  it("refuses an implicit task in front of another implicit task", () => {
    expect(
      refusal(IMPLICIT, {
        kind: "duplicateTask",
        target: task(1, "Second"),
      }),
    ).toContain("implicitStart");
    // The last implicit task of a chain can be copied: nothing follows it.
    const { text } = run(IMPLICIT, {
      kind: "duplicateTask",
      target: task(2, "Third"),
    });
    expect(text).toContain("    Third :2d\n    Third :2d\n");
  });

  it("refuses a stale target", () => {
    expect(
      refusal(IMPLICIT, { kind: "duplicateTask", target: task(0, "x") }),
    ).toContain("targetMismatch");
  });
});

describe("setAxisFormat", () => {
  it("adds a line under dateFormat, replaces the value, and removes repeated lines", () => {
    const added = run(REFERENCE, { kind: "setAxisFormat", format: "%m/%d" });
    expect(added.text).toBe(
      REFERENCE.replace(
        "    dateFormat YYYY-MM-DD\n",
        "    dateFormat YYYY-MM-DD\n    axisFormat %m/%d\n",
      ),
    );
    const replaced = run(added.text, {
      kind: "setAxisFormat",
      format: "%Y-%m-%d %b",
    });
    expect(replaced.text).toBe(added.text.replace("%m/%d", "%Y-%m-%d %b"));
    const twice = added.text.replace(
      "    axisFormat %m/%d\n",
      "    axisFormat %d\n    axisFormat %m/%d\n",
    );
    expect(run(twice, { kind: "setAxisFormat", format: "%b %d" }).text).toBe(
      added.text.replace("%m/%d", "%b %d"),
    );
  });

  it("changes nothing for the same value, and accepts padding modifiers", () => {
    const chart = REFERENCE.replace(
      "    dateFormat YYYY-MM-DD\n",
      "    dateFormat YYYY-MM-DD\n    axisFormat %m/%d\n",
    );
    const plan = planGanttOperation(chart, {
      kind: "setAxisFormat",
      format: "%m/%d",
    });
    expect(plan.ok && plan.value.edits).toEqual([]);
    run(chart, { kind: "setAxisFormat", format: "%-d %b week %U (%_m)" });
  });

  it("refuses text that is not a d3 time format Mermaid reads back as written", () => {
    for (const format of [
      "",
      " %m",
      "%m ",
      "%",
      "%m%",
      "%E",
      "%%",
      "%m # x",
      "%m;%d",
      "a\nb",
      "%m\t%d",
      "x".repeat(101),
      '<b class="x">%m</b>',
    ]) {
      expect(
        refusal(REFERENCE, { kind: "setAxisFormat", format }),
        JSON.stringify(format),
      ).toMatch(/^\w+: /);
    }
  });
});

describe("setExcludes and clearExcludes", () => {
  const WEEK = `gantt
    dateFormat YYYY-MM-DD
    section A
    Build :b1, 2024-01-05, 3d
    Test :b2, after b1, 2d
    Ship :2024-01-20, 2024-01-22
`;

  it("adds a line and moves the dates it changes, task by task", () => {
    const { text } = run(WEEK, { kind: "setExcludes", tokens: ["weekends"] });
    expect(text).toBe(
      WEEK.replace(
        "    dateFormat YYYY-MM-DD\n",
        "    dateFormat YYYY-MM-DD\n    excludes weekends\n",
      ),
    );
    const before = scheduleByName(WEEK);
    const after = scheduleByName(text);
    // Friday 5th + 3d lands on Thursday the 11th; Test follows.
    expect(after.get("Build")).not.toBe(before.get("Build"));
    expect(after.get("Test")).not.toBe(before.get("Test"));
    // A final end date is not moved.
    expect(after.get("Ship")).toBe(before.get("Ship"));
  });

  it("replaces and merges lines, normalises case and accepts dates and weekdays", () => {
    const first = run(WEEK, {
      kind: "setExcludes",
      tokens: ["Saturday", "2024-01-09", "MONDAY"],
    });
    expect(first.text).toContain("    excludes saturday, 2024-01-09, monday\n");
    const two = first.text.replace(
      "    excludes saturday, 2024-01-09, monday\n",
      "    excludes saturday\n    excludes sunday\n",
    );
    const merged = run(two, { kind: "setExcludes", tokens: ["weekends"] });
    expect(merged.text).toBe(
      WEEK.replace(
        "    dateFormat YYYY-MM-DD\n",
        "    dateFormat YYYY-MM-DD\n    excludes weekends\n",
      ),
    );
  });

  it("clears every excludes line and moves the dates back", () => {
    const withExcludes = run(WEEK, {
      kind: "setExcludes",
      tokens: ["weekends"],
    }).text;
    const { text } = run(withExcludes, { kind: "clearExcludes" });
    expect(text).toBe(WEEK);
    expect(refusal(WEEK, { kind: "clearExcludes" })).toContain("noExcludes");
  });

  it("refuses unknown, repeated and empty tokens and excluding all seven days", () => {
    expect(
      refusal(WEEK, { kind: "setExcludes", tokens: ["holiday"] }),
    ).toContain("unknownExcludeToken");
    expect(
      refusal(WEEK, { kind: "setExcludes", tokens: ["2024-02-30"] }),
    ).toContain("unknownExcludeToken");
    expect(
      refusal(WEEK, { kind: "setExcludes", tokens: ["monday", "Monday"] }),
    ).toContain("duplicateExcludeToken");
    expect(refusal(WEEK, { kind: "setExcludes", tokens: [] })).toContain(
      "noExcludeTokens",
    );
    expect(
      refusal(WEEK, {
        kind: "setExcludes",
        tokens: [
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "weekends",
        ],
      }),
    ).toContain("allDaysExcluded");
    expect(
      refusal(`${WEEK}    weekend friday\n`, {
        kind: "setExcludes",
        tokens: [
          "weekends",
          "sunday",
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
        ],
      }),
    ).toContain("allDaysExcluded");
  });

  it("refuses when the editor cannot compute where tasks land", () => {
    for (const unknown of [
      "    Long :l1, 2024-01-01, 1M\n",
      "    includes 2024-01-06\n    Build2 :c1, 2024-01-05, 3d\n",
      "    inclusiveEndDates\n    Build2 :c1, 2024-01-05, 3d\n",
    ]) {
      const chart = WEEK.replace(
        "    section A\n",
        `    section A\n${unknown}`,
      );
      expect(
        refusal(chart, { kind: "setExcludes", tokens: ["weekends"] }),
        unknown,
      ).toContain("unknownDates");
    }
  });
});

describe("addLink and removeLink", () => {
  it("accepts an axis format and a link URL exactly at their length limits, not one more", () => {
    const format = `%m${"-".repeat(GANTT_AXIS_FORMAT_MAX_LENGTH - 2)}`;
    expect(run(REFERENCE, { kind: "setAxisFormat", format }).text).toContain(
      `axisFormat ${format}\n`,
    );
    expect(
      refusal(REFERENCE, { kind: "setAxisFormat", format: `${format}-` }),
    ).toMatch(/^\w+: /);

    const prefix = "https://example.com/";
    const url = `${prefix}${"a".repeat(GANTT_LINK_URL_MAX_LENGTH - prefix.length)}`;
    expect(
      run(REFERENCE, { kind: "addLink", target: task(2, "Code"), url }).text,
    ).toContain(`href "${url}"`);
    expect(
      refusal(REFERENCE, {
        kind: "addLink",
        target: task(2, "Code"),
        url: `${url}a`,
      }),
    ).toMatch(/^\w+: /);
  });

  it("writes a click line below the task and takes it away again", () => {
    const { text } = run(REFERENCE, {
      kind: "addLink",
      target: task(2, "Code"),
      url: "https://example.com/spec?id=1",
    });
    expect(text).toBe(
      REFERENCE.replace(
        "    Code :crit, b1, after des2, 5d\n",
        '    Code :crit, b1, after des2, 5d\n    click b1 href "https://example.com/spec?id=1"\n',
      ),
    );
    expect(
      run(text, { kind: "removeLink", target: task(2, "Code") }).text,
    ).toBe(REFERENCE);
  });

  it("removes one id from a click line that names several", () => {
    const chart = `gantt
    dateFormat YYYY-MM-DD
    One :a1, 2024-01-01, 2d
    Two :a2, 2024-01-05, 2d
    Three :a3, 2024-01-09, 2d
    click a1,a2,a3 href "https://x.example/"
`;
    expect(
      run(chart, { kind: "removeLink", target: task(0, "One") }).text,
    ).toContain('click a2,a3 href "https://x.example/"');
    expect(
      run(chart, { kind: "removeLink", target: task(1, "Two") }).text,
    ).toContain('click a1,a3 href "https://x.example/"');
    expect(
      run(chart, { kind: "removeLink", target: task(2, "Three") }).text,
    ).toContain('click a1,a2 href "https://x.example/"');
  });

  it("refuses non-http links, a task without an id, a second link and a missing one", () => {
    for (const url of [
      "javascript:alert(1)",
      "ftp://example.com/",
      "//example.com/",
      "example.com",
      "https://",
      "https://exa mple.com/",
      'https://example.com/"x',
      "https://example.com/#top",
      "https://example.com/a;b",
      "https://example.com/100%",
      "https://example.com/日本",
      "HTTPS://EXAMPLE.COM/",
      "",
      `https://example.com/${"a".repeat(2000)}`,
    ]) {
      expect(
        refusal(REFERENCE, {
          kind: "addLink",
          target: task(0, "Spec"),
          url,
        }),
        url,
      ).toMatch(/^\w+: /);
    }
    expect(
      refusal(IMPLICIT, {
        kind: "addLink",
        target: task(0, "First"),
        url: "https://example.com/",
      }),
    ).toContain("noTaskId");
    expect(
      refusal(IMPLICIT, {
        kind: "addLink",
        target: task(3, "Other"),
        url: "https://example.com/",
      }),
    ).toContain("alreadyLinked");
    expect(
      refusal(REFERENCE, { kind: "removeLink", target: task(0, "Spec") }),
    ).toContain("noLink");
    expect(
      refusal(IMPLICIT, { kind: "removeLink", target: task(0, "First") }),
    ).toContain("noTaskId");
  });
});

describe("Tier 2 operations on a chart the editor cannot edit", () => {
  it("are refused as diagramNotEditable", () => {
    const chart = "gantt\n    dateFormat YYYY-MM-DD\n    topAxis\n";
    for (const operation of [
      { kind: "clearExcludes" },
      { kind: "setAxisFormat", format: "%m" },
      { kind: "moveTask", target: task(0, "x"), direction: "up" },
    ] as const) {
      const plan = planGanttOperation(chart, operation);
      expect(!plan.ok && plan.error.kind).toBe("diagramNotEditable");
    }
  });
});
