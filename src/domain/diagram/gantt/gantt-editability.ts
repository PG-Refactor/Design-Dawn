import type { LineRef } from "../source-lines";
import { GANTT_WEEKDAY_NAMES, GANTT_WEEKENDS_TOKEN } from "./gantt-config";
import type {
  GanttSourceIssueCode,
  GanttTaskEntry,
  GanttUnsupportedReason,
  ParsedGantt,
} from "./gantt-types";

// When may the GUI edit a gantt chart?
//
// Rule: every line was classified, nothing in the text makes the line-based reading differ
// from what Mermaid reads, the dates can be checked by the editor itself (a supported
// `dateFormat`), and the chart draws in Mermaid. Any single line that does not satisfy this
// makes the whole chart read-only: unlike a pie slice, a task's dates can depend on every
// other task, so a half-understood chart cannot be edited safely. Lines that are recognised
// but not edited (comments, directives, front matter, settings such as `excludes`, click
// links) never block an operation by themselves.

export type GanttNotEditableReason =
  | "notGantt"
  | GanttSourceIssueCode
  | "dateFormatMissing"
  | "duplicateDateFormat"
  | "unsupportedDateFormat"
  | "unsupportedLines"
  | "duplicateTaskIds"
  | "duplicateSectionNames"
  | "danglingReference"
  | "cyclicReference"
  | "allDaysExcluded"
  | "firstTaskImplicitStart";

export type GanttEditability =
  | { readonly editable: true }
  | {
      readonly editable: false;
      readonly reason: GanttNotEditableReason;
      readonly detail: string;
      readonly lines: readonly LineRef[];
    };

function refOf(parsed: ParsedGantt, lineIndex: number): LineRef {
  const line = parsed.lines[lineIndex];
  return line === undefined
    ? { index: lineIndex, start: 0, end: 0 }
    : { index: line.index, start: line.start, end: line.end };
}

function describeUnsupported(
  entries: readonly { lineIndex: number; reason: GanttUnsupportedReason }[],
): string {
  return entries
    .map((entry) => `line ${entry.lineIndex + 1} (${entry.reason})`)
    .join(", ");
}

export function findDuplicates(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

// Indexes of the tasks `task` depends on: the previous task for an implicit start, the
// tasks named by `after` and `until`.
export function dependencyIndexes(
  parsed: ParsedGantt,
  index: number,
): readonly number[] {
  const task = parsed.tasks[index] as GanttTaskEntry;
  const targets: number[] = [];
  if (task.start.kind === "implicit" && index > 0) targets.push(index - 1);
  for (const reference of [...task.startReferences, ...task.endReferences]) {
    const target = parsed.tasks.findIndex((other) => other.id === reference.id);
    if (target !== -1) targets.push(target);
  }
  return targets;
}

function hasCycle(parsed: ParsedGantt): boolean {
  const state = new Array<0 | 1 | 2>(parsed.tasks.length).fill(0);
  const visit = (index: number): boolean => {
    if (state[index] === 1) return true;
    if (state[index] === 2) return false;
    state[index] = 1;
    for (const target of dependencyIndexes(parsed, index)) {
      if (visit(target)) return true;
    }
    state[index] = 2;
    return false;
  };
  return parsed.tasks.some((_, index) => visit(index));
}

// The days `excludes` removes. Mermaid cannot place a task when all seven are removed.
function excludedWeekdays(parsed: ParsedGantt): ReadonlySet<string> {
  const weekend = parsed.settings.find(
    (setting) => setting.keyword === "weekend",
  );
  const weekendDays =
    weekend?.value === "friday"
      ? ["friday", "saturday"]
      : ["saturday", "sunday"];
  const days = new Set<string>();
  for (const setting of parsed.settings) {
    if (setting.keyword !== "excludes") continue;
    for (const token of setting.value.toLowerCase().split(/[\s,]+/)) {
      if (token === GANTT_WEEKENDS_TOKEN)
        for (const day of weekendDays) days.add(day);
      else if ((GANTT_WEEKDAY_NAMES as readonly string[]).includes(token))
        days.add(token);
    }
  }
  return days;
}

export function ganttEditability(parsed: ParsedGantt): GanttEditability {
  const fail = (
    reason: GanttNotEditableReason,
    detail: string,
    lineIndexes: readonly number[] = [],
  ): GanttEditability => ({
    editable: false,
    reason,
    detail,
    lines: lineIndexes.map((index) => refOf(parsed, index)),
  });
  if (!parsed.isGantt) {
    return fail(
      "notGantt",
      `not a readable gantt chart (${parsed.detection.kind})`,
    );
  }
  const [sourceIssue] = parsed.sourceIssues;
  if (sourceIssue !== undefined) {
    return fail(
      sourceIssue.code,
      sourceIssue.lineIndexes.length === 0
        ? "Mermaid rewrites or rejects this text before reading it"
        : `line ${sourceIssue.lineIndexes.map((index) => index + 1).join(", ")}`,
      sourceIssue.lineIndexes,
    );
  }
  if (parsed.dateFormatCount === 0) {
    return fail("dateFormatMissing", "the chart has no dateFormat line");
  }
  if (parsed.dateFormatCount > 1) {
    return fail(
      "duplicateDateFormat",
      "the chart has more than one dateFormat line",
    );
  }
  if (parsed.dateFormat === null) {
    return fail(
      "unsupportedDateFormat",
      "the dateFormat is not one the editor can check",
    );
  }
  if (parsed.unsupported.length > 0) {
    return fail(
      "unsupportedLines",
      describeUnsupported(parsed.unsupported),
      parsed.unsupported.map((entry) => entry.lineIndex),
    );
  }
  const taskIds = parsed.tasks.flatMap((task) =>
    task.id === null ? [] : [task.id],
  );
  const duplicateIds = findDuplicates(taskIds);
  if (duplicateIds.length > 0) {
    return fail(
      "duplicateTaskIds",
      `Mermaid binds every reference to the last task of a repeated id: ${duplicateIds.join(", ")}`,
      parsed.tasks
        .filter((task) => task.id !== null && duplicateIds.includes(task.id))
        .map((task) => task.lineIndex),
    );
  }
  const duplicateSections = findDuplicates(
    parsed.sections.map((section) => section.name),
  );
  if (duplicateSections.length > 0) {
    return fail(
      "duplicateSectionNames",
      `Mermaid draws sections of one name as one: ${duplicateSections.join(", ")}`,
      parsed.sections
        .filter((section) => duplicateSections.includes(section.name))
        .map((section) => section.lineIndex),
    );
  }
  const known = new Set(taskIds);
  const dangling = parsed.tasks.filter((task) =>
    [...task.startReferences, ...task.endReferences].some(
      (reference) => !known.has(reference.id),
    ),
  );
  if (dangling.length > 0) {
    return fail(
      "danglingReference",
      "a reference names a task that does not exist (Mermaid would use today's date or a stale task)",
      dangling.map((task) => task.lineIndex),
    );
  }
  if (hasCycle(parsed)) {
    return fail("cyclicReference", "tasks refer to each other in a circle");
  }
  if (excludedWeekdays(parsed).size === GANTT_WEEKDAY_NAMES.length) {
    return fail("allDaysExcluded", "excludes removes all seven days");
  }
  const first = parsed.tasks[0];
  if (first !== undefined && first.start.kind === "implicit") {
    return fail(
      "firstTaskImplicitStart",
      "the first task has no start (Mermaid cannot draw it)",
      [first.lineIndex],
    );
  }
  return { editable: true };
}
