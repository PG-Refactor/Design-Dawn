import { describe, expect, it } from "vitest";
import { parseGantt } from "./gantt-parser";

const gantt = (body: string) => `gantt\n    dateFormat YYYY-MM-DD\n${body}\n`;
const reasonsOf = (body: string) =>
  parseGantt(gantt(body)).unsupported.map((entry) => entry.reason);

const NO_BREAK_SPACE = " ";

describe("Gantt lines it does not read", () => {
  it.each([
    [
      "a no-break space in a statement",
      `    title A${NO_BREAK_SPACE}B`,
      "nonAsciiWhitespace",
    ],
    [
      "a line of a no-break space only",
      `${NO_BREAK_SPACE}`,
      "nonAsciiWhitespace",
    ],
    ["a setting without a value", "    excludes   ", "emptyDirectiveValue"],
    ["a ; in a setting", "    excludes weekends;", "specialCharacter"],
    ["a # in a setting", "    axisFormat %d#", "specialCharacter"],
    ["a title without text", "    title   ", "emptyDirectiveValue"],
    [
      "a # in a click link",
      '    A :a, 2026-01-01, 1d\n    click a href "https://x.example/#top"',
      "specialCharacter",
    ],
    [
      "a click id with a character an id cannot have",
      '    A :a, 2026-01-01, 1d\n    click a,b! href "https://x.example"',
      "clickReference",
    ],
    [
      "a task name with a forbidden character",
      "    A;B :a, 2026-01-01, 1d",
      "specialCharacter",
    ],
  ])("refuses %s", (_what, body, reason) => {
    expect(reasonsOf(body)).toContain(reason);
  });
});

describe("Gantt settings it reads", () => {
  it("reads weekday and a # in todayMarker", () => {
    const parsed = parseGantt(
      gantt("    weekday monday\n    todayMarker stroke:#f00"),
    );
    expect(parsed.unsupported).toEqual([]);
    expect(parsed.settings.map((setting) => setting.keyword)).toEqual([
      "dateformat",
      "weekday",
      "todaymarker",
    ]);
  });
});
