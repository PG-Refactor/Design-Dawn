import { describe, expect, it } from "vitest";
import { readGanttView } from "./gantt-view";

const SOURCE = `gantt
    title Release plan
    dateFormat YYYY-MM-DD
    Intro :i1, 2024-01-01, 1d
    section Design
    Spec :done, des1, 2024-01-02, 3d
    Review :active, des2, after des1, 2d
    section Build
    Code :crit, b1, after des2, until des1
    Test :3d
    section Empty
`;

describe("readGanttView", () => {
  it("is null for a chart the editor refuses and for other diagrams", () => {
    expect(readGanttView('pie\n  "A" : 1\n')).toBeNull();
    expect(
      readGanttView("gantt\n    dateFormat X\n    A :a, 1, 1d\n"),
    ).toBeNull();
    expect(readGanttView("gantt\n    topAxis\n")).toBeNull();
  });

  it("lists sections and tasks in source order with their texts as written", () => {
    const view = readGanttView(SOURCE);
    expect(view?.title).toBe("Release plan");
    expect(view?.dateFormat).toBe("YYYY-MM-DD");
    expect(view?.sections.map((s) => [s.target, s.taskCount])).toEqual([
      [{ index: 0, name: "Design" }, 2],
      [{ index: 1, name: "Build" }, 2],
      [{ index: 2, name: "Empty" }, 0],
    ]);
    expect(
      view?.tasks.map((t) => [
        t.target,
        t.sectionIndex,
        t.sectionName,
        t.id,
        t.tags,
        t.startText,
        t.endText,
      ]),
    ).toEqual([
      [{ index: 0, name: "Intro" }, -1, "", "i1", [], "2024-01-01", "1d"],
      [
        { index: 1, name: "Spec" },
        0,
        "Design",
        "des1",
        ["done"],
        "2024-01-02",
        "3d",
      ],
      [
        { index: 2, name: "Review" },
        0,
        "Design",
        "des2",
        ["active"],
        "after des1",
        "2d",
      ],
      [
        { index: 3, name: "Code" },
        1,
        "Build",
        "b1",
        ["crit"],
        "after des2",
        "until des1",
      ],
      [{ index: 4, name: "Test" }, 1, "Build", null, [], "", "3d"],
    ]);
  });

  it("gives the reason a control is unavailable", () => {
    const view = readGanttView(SOURCE);
    // A task that others depend on cannot be deleted; an empty section can.
    expect(view?.tasks[1]?.deleteRestriction).not.toBeNull();
    expect(view?.tasks[4]?.deleteRestriction).toBeNull();
    expect(view?.sections[2]?.deleteRestriction).toBeNull();
    expect(view?.sections[0]?.deleteRestriction).not.toBeNull();
    // A task that starts where the one above ends has no id to give.
    expect(view?.tasks[4]?.idRestriction).toBe("implicitStart");
    expect(view?.tasks[1]?.idRestriction).toBeNull();
    expect(view?.titleRestriction).toBeNull();
  });

  it("restricts the title when the chart has two", () => {
    const view = readGanttView(
      "gantt\n    title A\n    title B\n    dateFormat YYYY-MM-DD\n    T :t1, 2024-01-01, 1d\n",
    );
    expect(view?.titleRestriction).toBe("multipleTitles");
  });
});
