import { type DomainResult, ok } from "../../shared/domain-result";
import type { TextEdit } from "../text-edit";
import { GANTT_FIELD_SEPARATOR } from "./gantt-config";
import { formatGanttDate } from "./gantt-date";
import { insertLineAfter } from "./gantt-edit-lines";
import {
  type GanttMeaning,
  type GanttTaskMeaning,
  resolveGanttSchedule,
} from "./gantt-meaning";
import {
  existingIds,
  finish,
  type GanttOperationPlan,
  type GanttSectionTarget,
  type GanttTaskTarget,
  nextGeneratedId,
  type PreparedGantt,
  prepare,
  readBack,
  refuse,
  regionEnd,
  resolveSectionTarget,
  resolveTask,
} from "./gantt-operation-support";
import type { GanttLine, GanttTaskEntry, ParsedGantt } from "./gantt-types";

// Moving and duplicating tasks and sections (Tier 2, docs/architecture.md §16.17.2).
//
// A task that has no start of its own starts where the task above it ends, so moving a
// neighbour changes its date. The rule of every move here: no task may end up with a
// different resolved date. A task whose implicit start would get another predecessor is
// FROZEN: its start is written as the explicit date the editor's own resolver computes for it
// now (`Task :3d` becomes `Task :2024-01-01, 3d`). When the resolver cannot compute that date
// (months, `includes`, ...) the move is refused. Every move is a permutation of the lines, so
// the plan is the permuted text (plus the frozen starts) and the promised meaning carries the
// resolved dates of every task, which the candidate must reproduce.

export type GanttMoveDirection = "up" | "down";

const MOVABLE_LINE_KINDS: ReadonlySet<GanttLine["kind"]> = new Set([
  "section",
  "task",
  "blank",
  "comment",
  "click",
]);

interface Layout {
  // order[newPosition] = index of the line (in the current text) that ends up there.
  readonly order: readonly number[];
}

function identity(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

function freezeReason(task: GanttTaskEntry, index: number): string {
  return `task ${index} (${JSON.stringify(task.name)}) would start after a different task and its start would silently move; the editor would fix its start to the explicit date it has now, but cannot compute that date`;
}

// One edit that rewrites the span of lines that differ. Line breaks stay where they are
// (position by position), so a file without a final line break keeps none.
function editOfLines(
  parsed: ParsedGantt,
  texts: readonly string[],
): readonly TextEdit[] {
  const units = texts.map(
    (text, position) => text + (parsed.lines[position] as GanttLine).terminator,
  );
  const same = (position: number) =>
    units[position] ===
    (parsed.lines[position] as GanttLine).text +
      (parsed.lines[position] as GanttLine).terminator;
  let first = 0;
  while (first < units.length && same(first)) first += 1;
  if (first === units.length) return [];
  let last = units.length - 1;
  while (last > first && same(last)) last -= 1;
  const lastLine = parsed.lines[last] as GanttLine;
  return [
    {
      start: (parsed.lines[first] as GanttLine).start,
      end: lastLine.end + lastLine.terminator.length,
      text: units.slice(first, last + 1).join(""),
    },
  ];
}

function sameSchedule<T>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// Applies the layout, freezes what has to be frozen, builds the meaning the result must have
// (including every resolved date) and proves the text with the editor's own reader.
function planLayout(
  prepared: PreparedGantt,
  layout: Layout,
): DomainResult<GanttOperationPlan> {
  const { parsed, meaning, format } = prepared;
  const newPositionOf = new Map<number, number>();
  layout.order.forEach((line, position) => {
    newPositionOf.set(line, position);
  });
  const positionOfLine = (line: number) => newPositionOf.get(line) as number;

  // A click must stay below the task it names.
  const idToTask = new Map(
    parsed.tasks.flatMap((task) =>
      task.id === null ? [] : [[task.id, task] as const],
    ),
  );
  for (const click of parsed.clicks) {
    for (const reference of click.references) {
      const task = idToTask.get(reference.id);
      if (
        task !== undefined &&
        positionOfLine(task.lineIndex) > positionOfLine(click.lineIndex)
      ) {
        return refuse(
          "clickLink",
          "a click line would come before the task it names and stop working",
        );
      }
    }
  }

  const taskOrder = parsed.tasks
    .map((_, index) => index)
    .sort(
      (left, right) =>
        positionOfLine((parsed.tasks[left] as GanttTaskEntry).lineIndex) -
        positionOfLine((parsed.tasks[right] as GanttTaskEntry).lineIndex),
    );
  const oldSchedule = resolveGanttSchedule(meaning);

  // Sections in their new order, and the section each task falls under.
  const headerAt = new Map(
    parsed.sections.map((section) => [section.lineIndex, section.name]),
  );
  const sectionOfTask = new Map<number, string>();
  const sections: string[] = [];
  let currentSection = "";
  for (const line of layout.order) {
    const header = headerAt.get(line);
    if (header !== undefined) {
      currentSection = header;
      sections.push(header);
    }
    const taskIndex = parsed.tasks.findIndex((task) => task.lineIndex === line);
    if (taskIndex !== -1) sectionOfTask.set(taskIndex, currentSection);
  }

  // Freeze the implicit starts that would get another predecessor.
  const frozen = new Map<number, string>();
  for (const [position, oldIndex] of taskOrder.entries()) {
    const task = meaning.tasks[oldIndex] as GanttTaskMeaning;
    if (task.start.kind !== "implicit") continue;
    if (position > 0 && taskOrder[position - 1] === oldIndex - 1) continue;
    const start = oldSchedule[oldIndex]?.start;
    if (start === undefined) {
      return refuse(
        "cannotFreeze",
        freezeReason(parsed.tasks[oldIndex] as GanttTaskEntry, oldIndex),
      );
    }
    frozen.set(oldIndex, formatGanttDate(format, start));
  }

  const tasks = taskOrder.map((oldIndex): GanttTaskMeaning => {
    const task = meaning.tasks[oldIndex] as GanttTaskMeaning;
    const frozenStart = frozen.get(oldIndex);
    return {
      ...task,
      section: sectionOfTask.get(oldIndex) as string,
      start:
        frozenStart === undefined
          ? task.start
          : { kind: "date", text: frozenStart },
    };
  });
  const byNewLine = <T extends { readonly lineIndex: number }>(
    entries: readonly T[],
  ) =>
    [...entries].sort(
      (left, right) =>
        positionOfLine(left.lineIndex) - positionOfLine(right.lineIndex),
    );
  const unscheduled: GanttMeaning = {
    ...meaning,
    sections,
    tasks,
    links: byNewLine(parsed.clicks).flatMap((click) =>
      click.references.map((reference) => ({
        id: reference.id,
        url: click.url,
      })),
    ),
    settings: byNewLine(parsed.settings).map((setting) => ({
      keyword: setting.keyword,
      value: setting.value,
    })),
  };
  const schedule = resolveGanttSchedule(unscheduled);
  const moved = taskOrder.findIndex(
    (oldIndex, position) =>
      !sameSchedule(schedule[position], oldSchedule[oldIndex]),
  );
  if (moved !== -1) {
    return refuse(
      "datesWouldChange",
      `task ${taskOrder[moved]} would get other dates`,
    );
  }
  const expected: GanttMeaning = { ...unscheduled, schedule };

  const texts = layout.order.map((lineIndex) => {
    const line = parsed.lines[lineIndex] as GanttLine;
    const taskIndex = parsed.tasks.findIndex(
      (task) => task.lineIndex === lineIndex,
    );
    const start = frozen.get(taskIndex);
    if (start === undefined) return line.text;
    const at = (parsed.tasks[taskIndex] as GanttTaskEntry).endSpan.start;
    const offset = at - line.start;
    return `${line.text.slice(0, offset)}${start}${GANTT_FIELD_SEPARATOR}${line.text.slice(offset)}`;
  });
  const edits = editOfLines(parsed, texts);
  const planned = finish(edits, expected);
  if (!planned.ok) return planned;
  const checked = readBack(parsed.source, edits, expected);
  if (!checked.ok) return checked;
  return ok({
    ...planned.value,
    ...(frozen.size > 0 ? { frozenTasks: [...frozen.keys()] } : {}),
  });
}

// A task and the click lines right below it that name only that task: they move together,
// because a click works only below its task.
function taskUnit(
  parsed: ParsedGantt,
  task: GanttTaskEntry,
): readonly number[] {
  const unit = [task.lineIndex];
  for (let index = task.lineIndex + 1; ; index += 1) {
    const click = parsed.clicks.find((entry) => entry.lineIndex === index);
    if (
      click === undefined ||
      task.id === null ||
      !click.references.every((reference) => reference.id === task.id)
    ) {
      return unit;
    }
    unit.push(index);
  }
}

export function moveTask(
  source: string,
  target: GanttTaskTarget,
  direction: GanttMoveDirection,
): DomainResult<GanttOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed } = prepared.value;
  const found = resolveTask(parsed, target);
  if (!found.ok) return found;
  const neighbor = parsed.tasks[target.index + (direction === "up" ? -1 : 1)];
  if (
    neighbor === undefined ||
    neighbor.sectionIndex !== found.value.sectionIndex
  ) {
    return refuse(
      "atBoundary",
      `the task is already the ${direction === "up" ? "first" : "last"} of its section`,
    );
  }
  const [upper, lower] =
    direction === "up" ? [neighbor, found.value] : [found.value, neighbor];
  const upperUnit = taskUnit(parsed, upper);
  const lowerUnit = taskUnit(parsed, lower);
  const between = identity(lower.lineIndex).slice(
    (upperUnit[upperUnit.length - 1] as number) + 1,
  );
  const order = [
    ...identity(upper.lineIndex),
    ...lowerUnit,
    ...between,
    ...upperUnit,
    ...identity(parsed.lines.length).slice(
      (lowerUnit[lowerUnit.length - 1] as number) + 1,
    ),
  ];
  return planLayout(prepared.value, { order });
}

export function moveTaskToSection(
  source: string,
  target: GanttTaskTarget,
  sectionIndex: number,
): DomainResult<GanttOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed } = prepared.value;
  const found = resolveTask(parsed, target);
  if (!found.ok) return found;
  if (
    !Number.isInteger(sectionIndex) ||
    sectionIndex < 0 ||
    sectionIndex >= parsed.sections.length
  ) {
    return refuse("invalidIndex", `section ${sectionIndex} does not exist`);
  }
  if (found.value.sectionIndex === sectionIndex) {
    return refuse("sameSection", "the task is already in that section");
  }
  const unit = taskUnit(parsed, found.value);
  const anchor = regionEnd(parsed, sectionIndex);
  const order = identity(parsed.lines.length).filter(
    (line) => !unit.includes(line),
  );
  order.splice(order.indexOf(anchor) + 1, 0, ...unit);
  return planLayout(prepared.value, { order });
}

// The lines of a section: its header up to the next header (or the end), comments and blank
// lines included.
function sectionLines(parsed: ParsedGantt, index: number): readonly number[] {
  const first = (parsed.sections[index] as { lineIndex: number }).lineIndex;
  const end = parsed.sections[index + 1]?.lineIndex ?? parsed.lines.length;
  return Array.from({ length: end - first }, (_, offset) => first + offset);
}

export function moveSection(
  source: string,
  target: GanttSectionTarget,
  direction: GanttMoveDirection,
): DomainResult<GanttOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed } = prepared.value;
  const found = resolveSectionTarget(parsed, target);
  if (!found.ok) return found;
  const otherIndex = target.index + (direction === "up" ? -1 : 1);
  if (otherIndex < 0 || otherIndex >= parsed.sections.length) {
    return refuse(
      "atBoundary",
      `the section is already the ${direction === "up" ? "first" : "last"}`,
    );
  }
  const earlier = sectionLines(parsed, Math.min(target.index, otherIndex));
  const later = sectionLines(parsed, Math.max(target.index, otherIndex));
  const odd = [...earlier, ...later].find(
    (line) => !MOVABLE_LINE_KINDS.has((parsed.lines[line] as GanttLine).kind),
  );
  if (odd !== undefined) {
    return refuse(
      "blockContent",
      `line ${odd + 1} is a setting, title or directive inside the sections to swap`,
    );
  }
  const start = earlier[0] as number;
  const order = [
    ...identity(start),
    ...later,
    ...earlier,
    ...identity(parsed.lines.length).slice(
      start + earlier.length + later.length,
    ),
  ];
  return planLayout(prepared.value, { order });
}

export function duplicateTask(
  source: string,
  target: GanttTaskTarget,
): DomainResult<GanttOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed, meaning } = prepared.value;
  const found = resolveTask(parsed, target);
  if (!found.ok) return found;
  const task = found.value;
  const original = meaning.tasks[target.index] as GanttTaskMeaning;
  const next = meaning.tasks[target.index + 1];
  if (original.start.kind === "implicit" && next?.start.kind === "implicit") {
    return refuse(
      "implicitStart",
      `task ${target.index + 1} starts where this task ends and would start after the copy instead`,
    );
  }
  const line = parsed.lines[task.lineIndex] as GanttLine;
  const copyId =
    task.id === null ? null : nextGeneratedId(existingIds(meaning));
  const idSpan = task.idSpan;
  const text =
    idSpan === null || copyId === null
      ? line.text
      : `${line.text.slice(0, idSpan.start - line.start)}${copyId}${line.text.slice(idSpan.end - line.start)}`;
  // The copy goes below the task and the click lines that follow it.
  let anchor = task.lineIndex;
  for (
    let index = anchor + 1;
    parsed.lines[index]?.kind === "click" &&
    parsed.clicks.some(
      (click) =>
        click.lineIndex === index &&
        click.references.some((reference) => reference.id === task.id),
    );
    index += 1
  ) {
    anchor = index;
  }
  const tasks = [...meaning.tasks];
  tasks.splice(target.index + 1, 0, { ...original, id: copyId });
  const schedule = resolveGanttSchedule({ ...meaning, tasks });
  const oldSchedule = resolveGanttSchedule(meaning);
  const changed = oldSchedule.findIndex(
    (dates, index) =>
      !sameSchedule(dates, schedule[index <= target.index ? index : index + 1]),
  );
  if (changed !== -1) {
    return refuse("datesWouldChange", `task ${changed} would get other dates`);
  }
  const expected: GanttMeaning = { ...meaning, tasks, schedule };
  const edits = [insertLineAfter(parsed, anchor, text)];
  const planned = finish(edits, expected);
  if (!planned.ok) return planned;
  const checked = readBack(parsed.source, edits, expected);
  if (!checked.ok) return checked;
  return planned;
}
