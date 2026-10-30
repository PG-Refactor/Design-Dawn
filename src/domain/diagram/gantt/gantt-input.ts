import { GANTT_AFTER_KEYWORD, GANTT_UNTIL_KEYWORD } from "./gantt-config";
import { isGanttDuration } from "./gantt-date";
import type { GanttEndInput, GanttStartInput } from "./gantt-operations";
import type { GanttEnd, GanttStart } from "./gantt-types";

// The text a person types for a task's start or end, and the text shown for one. The GUI uses
// one text field per spec so a date, a duration and a reference are written the way they are
// in the source. Nothing here validates a date: the operation does, with the chart's format.

const WORD_SEPARATOR_PATTERN = /\s+/;

function idsAfterKeyword(
  text: string,
  keyword: string,
): readonly string[] | null {
  const prefix = `${keyword} `;
  if (!text.startsWith(prefix)) return null;
  return text
    .slice(prefix.length)
    .split(WORD_SEPARATOR_PATTERN)
    .filter((id) => id !== "");
}

// `after a b` is a reference to tasks; anything else is taken as a date.
export function ganttStartInputOf(text: string): GanttStartInput {
  const trimmed = text.trim();
  const ids = idsAfterKeyword(trimmed, GANTT_AFTER_KEYWORD);
  return ids === null
    ? { kind: "date", text: trimmed }
    : { kind: "after", ids };
}

// `3d` is a duration, `until a` a reference to tasks; anything else is taken as a date.
export function ganttEndInputOf(text: string): GanttEndInput {
  const trimmed = text.trim();
  if (isGanttDuration(trimmed)) return { kind: "duration", text: trimmed };
  const ids = idsAfterKeyword(trimmed, GANTT_UNTIL_KEYWORD);
  return ids === null
    ? { kind: "date", text: trimmed }
    : { kind: "until", ids };
}

// "" for a start taken from the task above.
export function ganttStartText(start: GanttStart): string {
  switch (start.kind) {
    case "implicit":
      return "";
    case "date":
      return start.text;
    case "after":
      return `${GANTT_AFTER_KEYWORD} ${start.ids.join(" ")}`;
  }
}

export function ganttEndText(end: GanttEnd): string {
  return end.kind === "until"
    ? `${GANTT_UNTIL_KEYWORD} ${end.ids.join(" ")}`
    : end.text;
}
