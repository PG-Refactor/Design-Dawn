import { describe, expect, it } from "vitest";
import {
  asGanttDateFormat,
  formatGanttDate,
  ganttDurationMs,
  isGanttDuration,
  parseGanttDate,
} from "./gantt-date";

const DAY_MS = 86_400_000;

describe("parseGanttDate", () => {
  it("reads a real date in every supported format", () => {
    const expected = Date.UTC(2024, 0, 31);
    expect(parseGanttDate("YYYY-MM-DD", "2024-01-31")).toBe(expected);
    expect(parseGanttDate("YYYY/MM/DD", "2024/01/31")).toBe(expected);
    expect(parseGanttDate("DD/MM/YYYY", "31/01/2024")).toBe(expected);
    expect(parseGanttDate("MM/DD/YYYY", "01/31/2024")).toBe(expected);
    expect(parseGanttDate("YYYY-MM-DD HH:mm", "2024-01-31 00:00")).toBe(
      expected,
    );
    expect(parseGanttDate("YYYY-MM-DD HH:mm", "2024-01-31 09:30")).toBe(
      expected + 9.5 * 3_600_000,
    );
  });

  it("refuses what JavaScript's Date would rescue", () => {
    expect(parseGanttDate("YYYY-MM-DD", "2024-02-30")).toBeNull();
    expect(parseGanttDate("YYYY-MM-DD", "2023-02-29")).toBeNull();
    expect(parseGanttDate("YYYY-MM-DD", "2024-04-31")).toBeNull();
    expect(parseGanttDate("YYYY-MM-DD", "2024-13-01")).toBeNull();
    expect(parseGanttDate("YYYY-MM-DD", "2024-00-10")).toBeNull();
    expect(parseGanttDate("YYYY-MM-DD", "2024-1-5")).toBeNull();
    expect(parseGanttDate("YYYY-MM-DD", " 2024-01-05")).toBeNull();
    expect(parseGanttDate("YYYY-MM-DD", "Jan 1 2024")).toBeNull();
  });

  it("accepts a leap day only in a leap year", () => {
    expect(parseGanttDate("YYYY-MM-DD", "2024-02-29")).not.toBeNull();
    expect(parseGanttDate("YYYY-MM-DD", "1900-02-29")).toBeNull();
    expect(parseGanttDate("YYYY-MM-DD", "2000-02-29")).not.toBeNull();
  });

  it("checks the time of day and the format shape", () => {
    expect(parseGanttDate("YYYY-MM-DD HH:mm", "2024-01-01 24:00")).toBeNull();
    expect(parseGanttDate("YYYY-MM-DD HH:mm", "2024-01-01 12:60")).toBeNull();
    expect(parseGanttDate("YYYY-MM-DD HH:mm", "2024-01-01")).toBeNull();
    expect(parseGanttDate("YYYY-MM-DD", "2024-01-01 09:30")).toBeNull();
    expect(parseGanttDate("DD/MM/YYYY", "2024/01/31")).toBeNull();
  });

  it("refuses years outside the four-digit range", () => {
    expect(parseGanttDate("YYYY-MM-DD", "0999-01-01")).toBeNull();
    expect(parseGanttDate("YYYY-MM-DD", "1000-01-01")).not.toBeNull();
    expect(parseGanttDate("YYYY-MM-DD", "9999-12-31")).not.toBeNull();
  });
});

describe("formatGanttDate", () => {
  it("round-trips through every format", () => {
    const value = Date.UTC(2024, 11, 5, 7, 8);
    expect(formatGanttDate("YYYY-MM-DD", value)).toBe("2024-12-05");
    expect(formatGanttDate("YYYY/MM/DD", value)).toBe("2024/12/05");
    expect(formatGanttDate("DD/MM/YYYY", value)).toBe("05/12/2024");
    expect(formatGanttDate("MM/DD/YYYY", value)).toBe("12/05/2024");
    expect(formatGanttDate("YYYY-MM-DD HH:mm", value)).toBe("2024-12-05 07:08");
    for (const format of [
      "YYYY-MM-DD",
      "YYYY/MM/DD",
      "DD/MM/YYYY",
      "MM/DD/YYYY",
      "YYYY-MM-DD HH:mm",
    ] as const) {
      const text = formatGanttDate(format, value);
      const reparsed = parseGanttDate(format, text);
      expect(reparsed).not.toBeNull();
      expect(formatGanttDate(format, reparsed as number)).toBe(text);
    }
  });
});

describe("asGanttDateFormat", () => {
  it("knows the supported formats, ignoring surrounding blanks", () => {
    expect(asGanttDateFormat(" YYYY-MM-DD ")).toBe("YYYY-MM-DD");
    expect(asGanttDateFormat("YYYY-MM-DD HH:mm")).toBe("YYYY-MM-DD HH:mm");
    expect(asGanttDateFormat("MM-DD-YYYY")).toBeNull();
    expect(asGanttDateFormat("YYYY-MM-DD %% c")).toBeNull();
    expect(asGanttDateFormat("")).toBeNull();
  });
});

describe("durations", () => {
  it("accepts exactly the pattern Mermaid reads as a length", () => {
    for (const text of [
      "1d",
      "2.5h",
      "30m",
      "1w",
      "1M",
      "1y",
      "5s",
      "500ms",
      "0d",
    ]) {
      expect(isGanttDuration(text), text).toBe(true);
    }
    for (const text of [
      "5 days",
      "10D",
      "1w2d",
      "-1d",
      "d",
      "1",
      "1.d",
      " 1d",
    ]) {
      expect(isGanttDuration(text), text).toBe(false);
    }
  });

  it("predicts whole days, weeks, hours and minutes only", () => {
    expect(ganttDurationMs("2d")).toBe(2 * DAY_MS);
    expect(ganttDurationMs("1w")).toBe(7 * DAY_MS);
    expect(ganttDurationMs("3h")).toBe(3 * 3_600_000);
    expect(ganttDurationMs("30m")).toBe(30 * 60_000);
    for (const text of ["1.5d", "1M", "1y", "10s", "500ms", "x"]) {
      expect(ganttDurationMs(text), text).toBeNull();
    }
  });
});
