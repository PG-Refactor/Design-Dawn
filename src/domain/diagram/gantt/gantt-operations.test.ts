import { describe, expect, it } from "vitest";
import { applyTextEdits } from "../text-edit";
import {
  type GanttOperation,
  planGanttOperation,
  verifyGanttCandidate,
} from "./gantt-operations";

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

const task = (index: number, name: string) => ({ index, name });
const section = (index: number, name: string) => ({ index, name });

// Plans, applies and proves one operation; returns the new text.
function run(source: string, operation: GanttOperation): string {
  const plan = planGanttOperation(source, operation);
  if (!plan.ok) throw new Error(`refused: ${plan.error.detail}`);
  const applied = applyTextEdits(source, plan.value.edits);
  if (!applied.ok) throw new Error(`edits: ${applied.error.detail}`);
  const verdict = verifyGanttCandidate(applied.value.text, plan.value.expected);
  if (!verdict.ok) throw new Error(`verify: ${verdict.error.detail}`);
  return applied.value.text;
}

function refusal(source: string, operation: GanttOperation): string {
  const plan = planGanttOperation(source, operation);
  if (plan.ok) throw new Error("expected a refusal");
  return plan.error.detail;
}

describe("title", () => {
  it("replaces, inserts after the header, and clears", () => {
    expect(run(REFERENCE, { kind: "setTitle", title: "Plan B" })).toBe(
      REFERENCE.replace("Release plan", "Plan B"),
    );
    const bare =
      "gantt\n    dateFormat YYYY-MM-DD\n    A :a1, 2024-01-01, 1d\n";
    expect(run(bare, { kind: "setTitle", title: "New" })).toBe(
      "gantt\n    title New\n    dateFormat YYYY-MM-DD\n    A :a1, 2024-01-01, 1d\n",
    );
    expect(run(REFERENCE, { kind: "clearTitle" })).toBe(
      REFERENCE.replace("    title Release plan\n", ""),
    );
  });

  it("changes nothing when the title is the same", () => {
    const plan = planGanttOperation(REFERENCE, {
      kind: "setTitle",
      title: "Release plan",
    });
    expect(plan.ok && plan.value.edits).toEqual([]);
  });

  it("refuses titles Mermaid would misread", () => {
    for (const title of [
      "",
      " x",
      "x ",
      "a;b",
      "a #b",
      "a %% b",
      '<b class="x">y</b>',
      "a\nb",
      "5% rule",
    ]) {
      expect(refusal(REFERENCE, { kind: "setTitle", title }), title).toMatch(
        /^\w+: /,
      );
    }
    expect(
      refusal(REFERENCE.replace("title Release plan", "title A\n    title B"), {
        kind: "setTitle",
        title: "C",
      }),
    ).toContain("multipleTitles");
    expect(
      refusal("gantt\n    dateFormat YYYY-MM-DD\n    A :a1, 2024-01-01, 1d\n", {
        kind: "clearTitle",
      }),
    ).toContain("noTitle");
  });
});

describe("sections", () => {
  it("adds a section at the end, or after the tasks of a section, never under a header", () => {
    expect(run(REFERENCE, { kind: "addSection", name: "Ship" })).toBe(
      `${REFERENCE}    section Ship\n`,
    );
    expect(
      run(REFERENCE, { kind: "addSection", name: "QA", afterSectionIndex: 0 }),
    ).toBe(
      REFERENCE.replace(
        "    section Build\n",
        "    section QA\n    section Build\n",
      ),
    );
  });

  it("keeps the tasks of the sections it is placed between", () => {
    const text = run(REFERENCE, {
      kind: "addSection",
      name: "QA",
      afterSectionIndex: 0,
    });
    expect(text.indexOf("section QA")).toBeGreaterThan(text.indexOf("Review"));
    expect(text.indexOf("section QA")).toBeLessThan(
      text.indexOf("section Build"),
    );
  });

  it("refuses an empty, duplicate or unsafe name and a bad position", () => {
    expect(refusal(REFERENCE, { kind: "addSection", name: "" })).toContain(
      "emptyText",
    );
    expect(
      refusal(REFERENCE, { kind: "addSection", name: "Design" }),
    ).toContain("duplicateSectionName");
    expect(refusal(REFERENCE, { kind: "addSection", name: "a;b" })).toContain(
      "specialCharacter",
    );
    expect(
      refusal(REFERENCE, {
        kind: "addSection",
        name: "X",
        afterSectionIndex: 2,
      }),
    ).toContain("invalidIndex");
    expect(
      refusal(REFERENCE, {
        kind: "addSection",
        name: "X",
        afterSectionIndex: -1,
      }),
    ).toContain("invalidIndex");
  });

  it("renames a section and its tasks follow", () => {
    expect(
      run(REFERENCE, {
        kind: "renameSection",
        target: section(1, "Build"),
        name: "Make",
      }),
    ).toBe(REFERENCE.replace("section Build", "section Make"));
    expect(
      refusal(REFERENCE, {
        kind: "renameSection",
        target: section(1, "Build"),
        name: "Design",
      }),
    ).toContain("duplicateSectionName");
    expect(
      refusal(REFERENCE, {
        kind: "renameSection",
        target: section(1, "Nope"),
        name: "X",
      }),
    ).toContain("targetMismatch");
    expect(
      refusal(REFERENCE, {
        kind: "renameSection",
        target: section(5, "Build"),
        name: "X",
      }),
    ).toContain("targetNotFound");
  });

  it("deletes an empty section, and a section no one depends on", () => {
    const withEmpty = `${REFERENCE}    section Empty\n`;
    expect(
      run(withEmpty, { kind: "deleteSection", target: section(2, "Empty") }),
    ).toBe(REFERENCE);
    const independent = `${REFERENCE}    section Tail\n    Last :t1, 2024-03-01, 1d\n`;
    expect(
      run(independent, { kind: "deleteSection", target: section(2, "Tail") }),
    ).toBe(REFERENCE);
  });

  it("refuses to delete a section whose tasks others depend on", () => {
    expect(
      refusal(REFERENCE, {
        kind: "deleteSection",
        target: section(0, "Design"),
      }),
    ).toContain("danglingReference");
    // The first task of section B would start where the deleted last task of A ended.
    const chained =
      "gantt\n    dateFormat YYYY-MM-DD\n    section A\n    First :f1, 2024-01-01, 2d\n    Second :3d\n    section B\n    Other :4d\n";
    expect(
      refusal(chained, { kind: "deleteSection", target: section(0, "A") }),
    ).toContain("implicitStart");
    expect(
      refusal(IMPLICIT, { kind: "deleteSection", target: section(1, "B") }),
    ).toContain("clickLink");
  });
});

describe("addTask", () => {
  it("adds a task with a generated id at the end", () => {
    const text = run(REFERENCE, {
      kind: "addTask",
      name: "Deploy",
      start: { kind: "after", ids: ["m1"] },
      end: { kind: "duration", text: "1d" },
    });
    expect(text).toBe(`${REFERENCE}    Deploy :gt1, after m1, 1d\n`);
  });

  it("adds to the end of a chosen section, with tags and an end date", () => {
    const text = run(REFERENCE, {
      kind: "addTask",
      sectionIndex: 0,
      name: "Sign off",
      id: "sg",
      tags: ["crit", "done"],
      start: { kind: "date", text: "2024-01-06" },
      end: { kind: "date", text: "2024-01-08" },
    });
    expect(text).toBe(
      REFERENCE.replace(
        "    section Build\n",
        "    Sign off :done, crit, sg, 2024-01-06, 2024-01-08\n    section Build\n",
      ),
    );
  });

  it("refuses to put a task in front of a task that starts where the one above ends", () => {
    const source =
      "gantt\n    dateFormat YYYY-MM-DD\n    section A\n    First :f1, 2024-01-01, 2d\n    section B\n    Second :3d\n";
    expect(
      refusal(source, {
        kind: "addTask",
        sectionIndex: 0,
        name: "New",
        start: { kind: "date", text: "2024-01-01" },
        end: { kind: "duration", text: "1d" },
      }),
    ).toContain("implicitStart");
    // At the end of the chart nothing follows.
    expect(
      run(source, {
        kind: "addTask",
        name: "New",
        start: { kind: "after", ids: ["f1"] },
        end: { kind: "duration", text: "1d" },
      }),
    ).toContain("New :gt1, after f1, 1d");
  });

  it("refuses names, ids, dates, durations and references Mermaid would misread", () => {
    const base = {
      kind: "addTask",
      start: { kind: "date", text: "2024-02-01" },
      end: { kind: "duration", text: "1d" },
    } as const;
    const bad: readonly [
      Partial<Extract<GanttOperation, { kind: "addTask" }>>,
      string,
    ][] = [
      [{ name: "a: b" }, "colon"],
      [{ name: "title x" }, "keywordLedName"],
      [{ name: "section x" }, "keywordLedName"],
      [{ name: "click x" }, "keywordLedName"],
      [{ name: "2024-01-01 plan" }, "keywordLedName"],
      [{ name: "5% rule" }, "commentMark"],
      [{ name: "x # y" }, "specialCharacter"],
      [{ name: "x; y" }, "specialCharacter"],
      [{ name: "" }, "emptyText"],
      [{ name: "ok", id: "m1" }, "duplicateId"],
      [{ name: "ok", id: "task3" }, "autoIdShape"],
      [{ name: "ok", id: "done" }, "tagWordId"],
      [{ name: "ok", id: "a.b" }, "invalidId"],
      [{ name: "ok", id: "a b" }, "invalidId"],
      [
        { name: "ok", start: { kind: "date", text: "2024-02-30" } },
        "invalidDate",
      ],
      [
        { name: "ok", start: { kind: "date", text: "2024-2-3" } },
        "invalidDate",
      ],
      [
        { name: "ok", start: { kind: "after", ids: ["zz"] } },
        "unknownReference",
      ],
      [{ name: "ok", start: { kind: "after", ids: [] } }, "noReference"],
      [
        { name: "ok", start: { kind: "after", ids: ["m1", "m1"] } },
        "duplicateReference",
      ],
      [
        { name: "ok", end: { kind: "duration", text: "5 days" } },
        "invalidDuration",
      ],
      [
        { name: "ok", end: { kind: "date", text: "2024-02-30" } },
        "invalidDate",
      ],
      [{ name: "ok", end: { kind: "until", ids: ["zz"] } }, "unknownReference"],
      [{ name: "ok", tags: ["nope" as never] }, "unknownTag"],
      [{ name: "ok", tags: ["done", "done"] }, "duplicateTag"],
      [{ name: "ok", sectionIndex: 9 }, "invalidIndex"],
    ];
    for (const [change, reason] of bad) {
      expect(
        refusal(REFERENCE, { ...base, name: "x", ...change } as GanttOperation),
        reason,
      ).toContain(reason);
    }
  });

  it("generates the first free id", () => {
    const text = run(REFERENCE.replaceAll("des1", "gt1"), {
      kind: "addTask",
      name: "Deploy",
      start: { kind: "date", text: "2024-05-01" },
      end: { kind: "duration", text: "1d" },
    });
    expect(text).toContain("Deploy :gt2, 2024-05-01, 1d");
  });

  it("works in a chart without sections or tasks", () => {
    const empty = "gantt\n    dateFormat YYYY-MM-DD\n";
    expect(
      run(empty, {
        kind: "addTask",
        name: "A",
        start: { kind: "date", text: "2024-01-01" },
        end: { kind: "duration", text: "1d" },
      }),
    ).toBe("gantt\n    dateFormat YYYY-MM-DD\n    A :gt1, 2024-01-01, 1d\n");
  });
});

describe("task fields", () => {
  it("renames a task", () => {
    expect(
      run(REFERENCE, {
        kind: "renameTask",
        target: task(2, "Code"),
        name: "Implementation",
      }),
    ).toBe(REFERENCE.replace("Code :", "Implementation :"));
    expect(
      refusal(REFERENCE, {
        kind: "renameTask",
        target: task(2, "Test"),
        name: "x",
      }),
    ).toContain("targetMismatch");
    expect(
      refusal(REFERENCE, {
        kind: "renameTask",
        target: task(2, "Code"),
        name: "a: b",
      }),
    ).toContain("colon");
  });

  it("renames an id and rewrites every reference, click included", () => {
    const text = run(
      IMPLICIT.replace(
        "First :2024-01-01, 2d",
        "First :f1, 2024-01-01, 2d",
      ).replace(
        "Other :o1, 2024-02-01, 5d",
        "Other :o1, after f1, 5d\n    Again :o2, 2024-03-01, until f1",
      ),
      {
        kind: "setTaskId",
        target: task(0, "First"),
        id: "start",
      },
    );
    expect(text).toContain("First :start, 2024-01-01, 2d");
    expect(text).toContain("Other :o1, after start, 5d");
    expect(text).toContain("Again :o2, 2024-03-01, until start");
    const clicked = run(IMPLICIT, {
      kind: "setTaskId",
      target: task(3, "Other"),
      id: "other",
    });
    expect(clicked).toContain('click other href "https://example.com/"');
  });

  it("gives a task without an id one, in front of its start", () => {
    expect(
      run(IMPLICIT, { kind: "setTaskId", target: task(0, "First"), id: "f1" }),
    ).toBe(IMPLICIT.replace("First :", "First :f1, "));
    expect(
      run("gantt\n    dateFormat YYYY-MM-DD\n    A :done, 2024-01-01, 1d\n", {
        kind: "setTaskId",
        target: task(0, "A"),
        id: "a1",
      }),
    ).toBe(
      "gantt\n    dateFormat YYYY-MM-DD\n    A :done, a1, 2024-01-01, 1d\n",
    );
    expect(
      refusal(IMPLICIT, {
        kind: "setTaskId",
        target: task(1, "Second"),
        id: "s2",
      }),
    ).toContain("implicitStart");
  });

  it("refuses ids that collide or would be misread", () => {
    expect(
      refusal(REFERENCE, {
        kind: "setTaskId",
        target: task(0, "Spec"),
        id: "des2",
      }),
    ).toContain("duplicateId");
    expect(
      refusal(REFERENCE, {
        kind: "setTaskId",
        target: task(0, "Spec"),
        id: "task1",
      }),
    ).toContain("autoIdShape");
    expect(
      refusal(REFERENCE, {
        kind: "setTaskId",
        target: task(0, "Spec"),
        id: "crit",
      }),
    ).toContain("tagWordId");
    expect(
      refusal(REFERENCE, {
        kind: "setTaskId",
        target: task(0, "Spec"),
        id: "a b",
      }),
    ).toContain("invalidId");
    const same = planGanttOperation(REFERENCE, {
      kind: "setTaskId",
      target: task(0, "Spec"),
      id: "des1",
    });
    expect(same.ok && same.value.edits).toEqual([]);
  });

  it("sets the start: a date, after, or a first explicit start", () => {
    expect(
      run(REFERENCE, {
        kind: "setStart",
        target: task(0, "Spec"),
        start: { kind: "date", text: "2024-02-01" },
      }),
    ).toBe(REFERENCE.replace("des1, 2024-01-01", "des1, 2024-02-01"));
    expect(
      run(REFERENCE, {
        kind: "setStart",
        target: task(4, "Release"),
        start: { kind: "after", ids: ["b1", "b2"] },
      }),
    ).toBe(REFERENCE.replace("after b2, 0d", "after b1 b2, 0d"));
    expect(
      run(IMPLICIT, {
        kind: "setStart",
        target: task(1, "Second"),
        start: { kind: "date", text: "2024-01-09" },
      }),
    ).toBe(IMPLICIT.replace("Second :3d", "Second :2024-01-09, 3d"));
  });

  it("refuses a start that would make a circle, name a missing task or be an invalid date", () => {
    expect(
      refusal(REFERENCE, {
        kind: "setStart",
        target: task(0, "Spec"),
        start: { kind: "after", ids: ["m1"] },
      }),
    ).toContain("cyclicReference");
    expect(
      refusal(REFERENCE, {
        kind: "setStart",
        target: task(0, "Spec"),
        start: { kind: "after", ids: ["des1"] },
      }),
    ).toContain("cyclicReference");
    expect(
      refusal(REFERENCE, {
        kind: "setStart",
        target: task(0, "Spec"),
        start: { kind: "after", ids: ["zz"] },
      }),
    ).toContain("unknownReference");
    expect(
      refusal(REFERENCE, {
        kind: "setStart",
        target: task(0, "Spec"),
        start: { kind: "date", text: "2023-02-29" },
      }),
    ).toContain("invalidDate");
  });

  it("sets the duration or the end", () => {
    expect(
      run(REFERENCE, {
        kind: "setDuration",
        target: task(2, "Code"),
        duration: "2w",
      }),
    ).toBe(REFERENCE.replace("5d", "2w"));
    expect(
      run(REFERENCE, {
        kind: "setEnd",
        target: task(2, "Code"),
        end: { kind: "date", text: "2024-02-01" },
      }),
    ).toBe(REFERENCE.replace("5d", "2024-02-01"));
    expect(
      run(REFERENCE, {
        kind: "setEnd",
        target: task(4, "Release"),
        end: { kind: "until", ids: ["des1"] },
      }),
    ).toContain("Release :milestone, m1, after b2, until des1");
    expect(
      refusal(REFERENCE, {
        kind: "setDuration",
        target: task(2, "Code"),
        duration: "2 weeks",
      }),
    ).toContain("invalidDuration");
    expect(
      refusal(REFERENCE, {
        kind: "setEnd",
        target: task(0, "Spec"),
        end: { kind: "until", ids: ["des2"] },
      }),
    ).toContain("cyclicReference");
  });

  it("sets the status tags, before the id, in a fixed order", () => {
    expect(
      run(REFERENCE, {
        kind: "setStatusTags",
        target: task(3, "Test"),
        tags: ["vert", "done"],
      }),
    ).toBe(REFERENCE.replace("Test :b2", "Test :done, vert, b2"));
    expect(
      run(REFERENCE, {
        kind: "setStatusTags",
        target: task(0, "Spec"),
        tags: [],
      }),
    ).toBe(REFERENCE.replace("done, des1", "des1"));
    expect(
      run(IMPLICIT, {
        kind: "setStatusTags",
        target: task(1, "Second"),
        tags: ["crit"],
      }),
    ).toBe(IMPLICIT.replace("Second :3d", "Second :crit, 3d"));
    const same = planGanttOperation(REFERENCE, {
      kind: "setStatusTags",
      target: task(0, "Spec"),
      tags: ["done"],
    });
    expect(same.ok && same.value.edits).toEqual([]);
    expect(
      refusal(REFERENCE, {
        kind: "setStatusTags",
        target: task(0, "Spec"),
        tags: ["nope" as never],
      }),
    ).toContain("unknownTag");
  });
});

describe("deleteTask", () => {
  it("deletes a task nothing depends on", () => {
    expect(
      run(REFERENCE, { kind: "deleteTask", target: task(4, "Release") }),
    ).toBe(REFERENCE.replace("    Release :milestone, m1, after b2, 0d\n", ""));
  });

  it("refuses when another task refers to it", () => {
    expect(
      refusal(REFERENCE, { kind: "deleteTask", target: task(0, "Spec") }),
    ).toContain("danglingReference");
  });

  it("refuses when a task starts where it ends, or a click names it", () => {
    expect(
      refusal(IMPLICIT, { kind: "deleteTask", target: task(0, "First") }),
    ).toContain("implicitStart");
    expect(
      refusal(IMPLICIT, { kind: "deleteTask", target: task(3, "Other") }),
    ).toContain("clickLink");
    // The last implicit task has no successor.
    expect(
      run(IMPLICIT, { kind: "deleteTask", target: task(2, "Third") }),
    ).toBe(IMPLICIT.replace("    Third :2d\n", ""));
  });
});

describe("layout", () => {
  it("keeps CRLF and a missing final line break", () => {
    const crlf = REFERENCE.replace(/\n/g, "\r\n");
    const added = run(crlf, {
      kind: "addTask",
      name: "Deploy",
      start: { kind: "after", ids: ["m1"] },
      end: { kind: "duration", text: "1d" },
    });
    expect(added).toBe(`${crlf}    Deploy :gt1, after m1, 1d\r\n`);
    const noFinalBreak = REFERENCE.trimEnd();
    const addedWithout = run(noFinalBreak, {
      kind: "addTask",
      name: "Deploy",
      start: { kind: "after", ids: ["m1"] },
      end: { kind: "duration", text: "1d" },
    });
    expect(addedWithout).toBe(`${noFinalBreak}\n    Deploy :gt1, after m1, 1d`);
    expect(
      run(noFinalBreak, { kind: "deleteTask", target: task(4, "Release") }),
    ).toBe(
      noFinalBreak.replace("\n    Release :milestone, m1, after b2, 0d", ""),
    );
  });

  it("changes nothing outside the edited range", () => {
    const plan = planGanttOperation(REFERENCE, {
      kind: "setDuration",
      target: task(1, "Review"),
      duration: "9d",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.edits).toHaveLength(1);
    const [edit] = plan.value.edits;
    expect(REFERENCE.slice(edit?.start, edit?.end)).toBe("2d");
  });

  it("refuses a chart that is not editable", () => {
    expect(
      refusal("gantt\n    A :a1, 2024-01-01, 1d\n", { kind: "clearTitle" }),
    ).toContain("dateFormatMissing");
    expect(refusal('pie\n  "a" : 1\n', { kind: "clearTitle" })).toContain(
      "notGantt",
    );
  });
});

describe("verifyGanttCandidate", () => {
  it("rejects a candidate that reads differently from the promise", () => {
    const plan = planGanttOperation(REFERENCE, {
      kind: "setDuration",
      target: task(2, "Code"),
      duration: "2w",
    });
    if (!plan.ok) throw new Error("plan");
    const wrong = REFERENCE.replace("5d", "3w");
    const verdict = verifyGanttCandidate(wrong, plan.value.expected);
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.error.kind).toBe("diagramMeaningMismatch");
    const unreadable = verifyGanttCandidate(
      REFERENCE.replace("5d", "5 days"),
      plan.value.expected,
    );
    expect(!unreadable.ok && unreadable.error.kind).toBe("diagramNotEditable");
  });
});
