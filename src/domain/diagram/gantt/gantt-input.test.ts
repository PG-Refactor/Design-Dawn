import { describe, expect, it } from "vitest";
import {
  ganttEndInputOf,
  ganttEndText,
  ganttStartInputOf,
  ganttStartText,
} from "./gantt-input";

describe("ganttStartInputOf", () => {
  it("reads `after` followed by ids as a reference and anything else as a date", () => {
    expect(ganttStartInputOf("after a1")).toEqual({
      kind: "after",
      ids: ["a1"],
    });
    expect(ganttStartInputOf("  after a1   b2 ")).toEqual({
      kind: "after",
      ids: ["a1", "b2"],
    });
    expect(ganttStartInputOf(" 2024-01-01 ")).toEqual({
      kind: "date",
      text: "2024-01-01",
    });
    expect(ganttStartInputOf("")).toEqual({ kind: "date", text: "" });
  });

  it("leaves a bare `after` to the operation to refuse", () => {
    expect(ganttStartInputOf("after")).toEqual({ kind: "date", text: "after" });
    expect(ganttStartInputOf("after ")).toEqual({
      kind: "date",
      text: "after",
    });
  });
});

describe("ganttEndInputOf", () => {
  it("tells a duration, a reference and a date apart", () => {
    expect(ganttEndInputOf("3d")).toEqual({ kind: "duration", text: "3d" });
    expect(ganttEndInputOf("1.5w")).toEqual({ kind: "duration", text: "1.5w" });
    expect(ganttEndInputOf("until a1 b2")).toEqual({
      kind: "until",
      ids: ["a1", "b2"],
    });
    expect(ganttEndInputOf("2024-02-01")).toEqual({
      kind: "date",
      text: "2024-02-01",
    });
    expect(ganttEndInputOf("3 days")).toEqual({ kind: "date", text: "3 days" });
  });
});

describe("spec texts", () => {
  it("write a spec the way the source does", () => {
    expect(ganttStartText({ kind: "implicit" })).toBe("");
    expect(ganttStartText({ kind: "date", text: "2024-01-01" })).toBe(
      "2024-01-01",
    );
    expect(ganttStartText({ kind: "after", ids: ["a", "b"] })).toBe(
      "after a b",
    );
    expect(ganttEndText({ kind: "duration", text: "2d" })).toBe("2d");
    expect(ganttEndText({ kind: "date", text: "2024-02-01" })).toBe(
      "2024-02-01",
    );
    expect(ganttEndText({ kind: "until", ids: ["a"] })).toBe("until a");
  });

  it("round-trip through the input readers", () => {
    expect(
      ganttStartInputOf(ganttStartText({ kind: "after", ids: ["a", "b"] })),
    ).toEqual({
      kind: "after",
      ids: ["a", "b"],
    });
    expect(
      ganttEndInputOf(ganttEndText({ kind: "until", ids: ["a"] })),
    ).toEqual({
      kind: "until",
      ids: ["a"],
    });
  });
});
