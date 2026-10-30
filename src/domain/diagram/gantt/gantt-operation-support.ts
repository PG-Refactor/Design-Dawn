import { type DomainResult, err, ok } from "../../shared/domain-result";
import { applyTextEdits, type TextEdit } from "../text-edit";
import {
  GANTT_GENERATED_ID_PREFIX,
  type GanttDateFormat,
} from "./gantt-config";
import { indentOf } from "./gantt-edit-lines";
import { ganttEditability } from "./gantt-editability";
import {
  checkGanttMeaning,
  findMeaningProblem,
  type GanttMeaning,
  type GanttTaskMeaning,
  ganttMeaningOf,
} from "./gantt-meaning";
import { parseGantt } from "./gantt-parser";
import type { GanttLine, GanttTaskEntry, ParsedGantt } from "./gantt-types";

// Shared by the gantt operation files: targets, the plan, reading a source into something an
// operation can edit, and the finder of the place a new line goes. No operation lives here.

export interface GanttTaskTarget {
  // Position among the tasks in source order, plus the name the caller believes it has.
  // Both must agree, so a stale index cannot silently change another task.
  readonly index: number;
  readonly name: string;
}

export interface GanttSectionTarget {
  readonly index: number;
  readonly name: string;
}

export interface GanttOperationPlan {
  readonly edits: readonly TextEdit[];
  readonly expected: GanttMeaning;
  // Indexes (in the source being edited) of the tasks whose implicit start the plan wrote as
  // an explicit date so that no date moves. Absent when the plan freezes nothing.
  readonly frozenTasks?: readonly number[];
}

export interface PreparedGantt {
  readonly parsed: ParsedGantt;
  readonly meaning: GanttMeaning;
  readonly format: GanttDateFormat;
}

export function refuse<T>(reason: string, detail: string): DomainResult<T> {
  return err("invalidDiagramOperation", `${reason}: ${detail}`);
}

export function prepare(source: string): DomainResult<PreparedGantt> {
  const parsed = parseGantt(source);
  const editability = ganttEditability(parsed);
  if (!editability.editable) {
    return err(
      "diagramNotEditable",
      `${editability.reason}: ${editability.detail}`,
    );
  }
  const meaning = ganttMeaningOf(parsed);
  if (meaning === null || parsed.dateFormat === null) {
    return err(
      "diagramNotEditable",
      "noMeaning: the chart has no meaning to edit",
    );
  }
  return ok({ parsed, meaning, format: parsed.dateFormat });
}

export function resolveTask(
  parsed: ParsedGantt,
  target: GanttTaskTarget,
): DomainResult<GanttTaskEntry> {
  const task = Number.isInteger(target.index)
    ? parsed.tasks[target.index]
    : undefined;
  if (task === undefined) {
    return refuse("targetNotFound", `no task at index ${target.index}`);
  }
  if (task.name !== target.name) {
    return refuse(
      "targetMismatch",
      `task ${target.index} is ${JSON.stringify(task.name)}, not ${JSON.stringify(target.name)}`,
    );
  }
  return ok(task);
}

export function resolveSectionTarget(
  parsed: ParsedGantt,
  target: GanttSectionTarget,
): DomainResult<number> {
  const section = Number.isInteger(target.index)
    ? parsed.sections[target.index]
    : undefined;
  if (section === undefined) {
    return refuse("targetNotFound", `no section at index ${target.index}`);
  }
  if (section.name !== target.name) {
    return refuse(
      "targetMismatch",
      `section ${target.index} is ${JSON.stringify(section.name)}, not ${JSON.stringify(target.name)}`,
    );
  }
  return ok(target.index);
}

export function replaceTask(
  meaning: GanttMeaning,
  index: number,
  change: Partial<GanttTaskMeaning>,
): GanttMeaning {
  return {
    ...meaning,
    tasks: meaning.tasks.map((task, position) =>
      position === index ? { ...task, ...change } : task,
    ),
  };
}

// The last chance to refuse: the meaning the operation promises must itself be editable.
export function finish(
  edits: readonly TextEdit[],
  expected: GanttMeaning,
): DomainResult<GanttOperationPlan> {
  const problem = findMeaningProblem(expected);
  if (problem !== null) return refuse(problem.code, problem.detail);
  return ok({ edits, expected });
}

export function existingIds(meaning: GanttMeaning): ReadonlySet<string> {
  return new Set(
    meaning.tasks.flatMap((task) => (task.id === null ? [] : [task.id])),
  );
}

// ---- lines ----

export type ContentKind = GanttLine["kind"];
export const NON_CONTENT_KINDS: ReadonlySet<ContentKind> = new Set([
  "blank",
  "comment",
  "directive",
  "frontMatter",
]);

// The last line, in [from, before), that holds a statement: the place after which a new line
// is neither inside nor in front of anything else.
export function lastContentLine(
  parsed: ParsedGantt,
  from: number,
  before: number,
): number {
  for (let index = before - 1; index > from; index -= 1) {
    const line = parsed.lines[index] as GanttLine;
    if (!NON_CONTENT_KINDS.has(line.kind)) return index;
  }
  return from;
}

export function headerLineIndex(parsed: ParsedGantt): number {
  return parsed.lines.findIndex((line) => line.kind === "header");
}

// The line after which new text for `sectionIndex` goes: the end of that section's region.
// Without a section, the end of the chart.
export function regionEnd(
  parsed: ParsedGantt,
  sectionIndex: number | undefined,
): number {
  if (sectionIndex === undefined) {
    return lastContentLine(
      parsed,
      headerLineIndex(parsed),
      parsed.lines.length,
    );
  }
  const section = parsed.sections[sectionIndex] as { lineIndex: number };
  const next = parsed.sections[sectionIndex + 1];
  return lastContentLine(
    parsed,
    section.lineIndex,
    next?.lineIndex ?? parsed.lines.length,
  );
}

export function taskIndentNear(parsed: ParsedGantt, lineIndex: number): string {
  const task = [...parsed.tasks]
    .reverse()
    .find((entry) => entry.lineIndex <= lineIndex);
  return indentOf(
    parsed.lines[(task ?? parsed.tasks[0])?.lineIndex ?? lineIndex],
  );
}

export function nextGeneratedId(known: ReadonlySet<string>): string {
  for (let number = 1; ; number += 1) {
    const candidate = `${GANTT_GENERATED_ID_PREFIX}${number}`;
    if (!known.has(candidate)) return candidate;
  }
}

// The plan is only handed out when the editor's own reader finds, in the text the edits
// make, exactly the promised meaning.
export function readBack(
  source: string,
  edits: readonly TextEdit[],
  expected: GanttMeaning,
): DomainResult<void> {
  const applied = applyTextEdits(source, edits);
  if (!applied.ok) return refuse("invalidEdits", applied.error.detail);
  const verdict = checkGanttMeaning(parseGantt(applied.value.text), expected);
  return verdict.ok
    ? ok(undefined)
    : refuse("unreadableResult", verdict.error.detail);
}
