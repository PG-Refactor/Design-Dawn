import { describe, expect, it } from "vitest";
import { readGanttMoveTargets, readGanttView } from "./gantt-view";

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

describe("readGanttView, Tier 2 controls", () => {
  const CHART = `gantt
    dateFormat YYYY-MM-DD
    axisFormat %m/%d
    excludes weekends, 2024-01-10
    section A
    One :a1, 2024-01-01, 2d
    click a1 href "https://one.example/"
    Two :3d
    section B
    Three :b1, 2024-02-01, 2d
`;

  it("shows the axis format, the excluded days, the link and why a control is off", () => {
    const view = readGanttView(CHART);
    expect(view?.axisFormat).toBe("%m/%d");
    expect(view?.excludes).toBe("weekends, 2024-01-10");
    expect(view?.axisFormatRestriction).toBeNull();
    expect(view?.excludesRestriction).toBeNull();
    expect(view?.tasks.map((task) => task.link)).toEqual([
      "https://one.example/",
      "",
      "",
    ]);
    // Two has no id; One already has a link; Three has neither problem.
    expect(view?.tasks[1]?.addLinkRestriction).toBe("noTaskId");
    expect(view?.tasks[0]?.addLinkRestriction).toBe("alreadyLinked");
    expect(view?.tasks[2]?.addLinkRestriction).toBeNull();
    expect(view?.tasks[2]?.removeLinkRestriction).toBe("noLink");
    expect(view?.tasks[0]?.removeLinkRestriction).toBeNull();
    // Two follows One and is the last of its section: it cannot go down, going up freezes it.
    expect(view?.tasks[1]?.moveDown.restriction).toBe("atBoundary");
    expect(view?.tasks[1]?.moveUp).toEqual({ restriction: null, freezes: 1 });
    expect(view?.tasks[0]?.moveDown.freezes).toBe(1);
    expect(view?.tasks[1]?.duplicateRestriction).toBeNull();
    expect(view?.sections[0]?.moveUp.restriction).toBe("atBoundary");
    expect(view?.sections[0]?.moveDown).toEqual({
      restriction: null,
      freezes: 0,
    });
  });

  it("says which sections a task can move to, and what that would freeze", () => {
    const targets = readGanttMoveTargets(CHART, { index: 1, name: "Two" });
    expect(targets).toEqual([
      { sectionIndex: 0, name: "A", restriction: "sameSection", freezes: 0 },
      { sectionIndex: 1, name: "B", restriction: null, freezes: 1 },
    ]);
    expect(
      readGanttMoveTargets("gantt\n    topAxis\n", { index: 0, name: "x" }),
    ).toEqual([]);
  });

  it("restricts excludes when the editor cannot compute the dates", () => {
    const view = readGanttView(
      "gantt\n    dateFormat YYYY-MM-DD\n    A :a1, 2024-01-01, 1M\n",
    );
    expect(view?.excludesRestriction).toBe("unknownDates");
    expect(view?.excludes).toBe("");
    expect(view?.axisFormat).toBe("");
  });
});
