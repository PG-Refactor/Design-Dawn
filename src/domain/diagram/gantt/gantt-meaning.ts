import { type DomainResult, err, ok } from "../../shared/domain-result";
import type {
  GanttDateFormat,
  GanttSettingKeyword,
  GanttTag,
} from "./gantt-config";
import {
  GANTT_END_DATE_MANUAL_FORMAT,
  GANTT_MAX_EXCLUDE_DAYS,
  GANTT_TAGS,
} from "./gantt-config";
import { ganttDurationMs, MS_PER_DAY, parseGanttDate } from "./gantt-date";
import { ganttEditability } from "./gantt-editability";
import {
  type ExcludeRules,
  excludeRulesOf,
  isExcludedDay,
} from "./gantt-excludes";
import type { GanttEnd, GanttStart, ParsedGantt } from "./gantt-types";

// What Mermaid 12.1.0 holds after reading a gantt chart, derived from the parse: the title,
// the sections in order, every task with its section, name, id (null when written without
// one), tags and the start and end as written, the click links and the settings. Dates are
// kept as the text that was written; `resolveGanttSchedule` computes them.

export interface GanttTaskMeaning {
  // The name of the section above the task, or "" before the first `section`.
  readonly section: string;
  readonly name: string;
  readonly id: string | null;
  // Always in GANTT_TAGS order, so the order they were written in does not matter.
  readonly tags: readonly GanttTag[];
  readonly start: GanttStart;
  readonly end: GanttEnd;
}

export interface GanttLinkMeaning {
  readonly id: string;
  readonly url: string;
}

export interface GanttSettingMeaning {
  readonly keyword: GanttSettingKeyword;
  readonly value: string;
}

export interface GanttMeaning {
  // The last `title` line, or "".
  readonly title: string;
  readonly dateFormat: GanttDateFormat;
  readonly sections: readonly string[];
  readonly tasks: readonly GanttTaskMeaning[];
  readonly links: readonly GanttLinkMeaning[];
  // Every setting line in source order. No operation changes one, so a candidate must hold
  // exactly the settings the source had.
  readonly settings: readonly GanttSettingMeaning[];
  // Set by an operation that promises where every task lands (a move, a change of
  // `excludes`): the dates `resolveGanttSchedule` must give for the candidate, task by task.
  // `ganttMeaningOf` never sets it; when it is absent nothing about dates is checked.
  readonly schedule?: readonly (ResolvedDates | null)[];
}

export function orderGanttTags(tags: readonly GanttTag[]): readonly GanttTag[] {
  return GANTT_TAGS.filter((tag) => tags.includes(tag));
}

// Null when the parse still holds an invalid spec or has no usable `dateFormat`: such a
// chart has no meaning to compare.
export function ganttMeaningOf(parsed: ParsedGantt): GanttMeaning | null {
  if (parsed.dateFormat === null) return null;
  const tasks: GanttTaskMeaning[] = [];
  for (const task of parsed.tasks) {
    if (task.start.kind === "invalid" || task.end.kind === "invalid")
      return null;
    tasks.push({
      section: parsed.sections[task.sectionIndex]?.name ?? "",
      name: task.name,
      id: task.id,
      tags: orderGanttTags(task.tags),
      start: task.start,
      end: task.end,
    });
  }
  return {
    title: parsed.titles[parsed.titles.length - 1]?.text ?? "",
    dateFormat: parsed.dateFormat,
    sections: parsed.sections.map((section) => section.name),
    tasks,
    links: parsed.clicks.flatMap((click) =>
      click.references.map((reference) => ({
        id: reference.id,
        url: click.url,
      })),
    ),
    settings: parsed.settings.map((setting) => ({
      keyword: setting.keyword,
      value: setting.value,
    })),
  };
}

export interface ResolvedDates {
  // Face-value milliseconds (see gantt-date.ts).
  readonly start: number;
  readonly end: number;
}

// Where the editor can predict it, the dates Mermaid computes: an explicit date, `after`
// (the latest end of the named tasks), `until` (the earliest start), an implicit start (the
// end of the task above in the source), a duration of whole days, weeks, hours or minutes, and
// the days `excludes` removes (an end that falls on or passes an excluded day moves later,
// day by day, as Mermaid does it). Null for a task whose dates depend on something the editor
// does not model: `includes` and `inclusiveEndDates`, and months, years, fractions, seconds
// and milliseconds (`s` and `ms` are measurably ignored by Mermaid). A time zone with
// daylight saving may shift an hour-based duration in Mermaid by an hour.
export function resolveGanttSchedule(
  meaning: GanttMeaning,
): readonly (ResolvedDates | null)[] {
  const unmodelled = meaning.settings.some(
    (setting) =>
      setting.keyword === "includes" || setting.keyword === "inclusiveenddates",
  );
  const count = meaning.tasks.length;
  if (unmodelled) return meaning.tasks.map(() => null);
  const rules = excludeRulesOf(meaning.settings, meaning.dateFormat);
  const indexOfId = new Map<string, number>();
  meaning.tasks.forEach((task, index) => {
    if (task.id !== null) indexOfId.set(task.id, index);
  });
  const memo = new Map<number, ResolvedDates | null>();
  const active = new Set<number>();
  const resolve = (index: number): ResolvedDates | null => {
    if (memo.has(index)) return memo.get(index) ?? null;
    if (active.has(index)) return null;
    active.add(index);
    const result = resolveTask(index);
    active.delete(index);
    memo.set(index, result);
    return result;
  };
  const resolveTask = (index: number): ResolvedDates | null => {
    const task = meaning.tasks[index];
    if (task === undefined) return null;
    let start: number | null = null;
    switch (task.start.kind) {
      case "date":
        start = parseGanttDate(meaning.dateFormat, task.start.text);
        break;
      case "implicit":
        start = index > 0 ? (resolve(index - 1)?.end ?? null) : null;
        break;
      case "after": {
        const ends = task.start.ids.map((id) => {
          const target = indexOfId.get(id);
          return target === undefined ? null : (resolve(target)?.end ?? null);
        });
        start = ends.includes(null) ? null : Math.max(...(ends as number[]));
        break;
      }
    }
    if (start === null) return null;
    let end: number | null = null;
    switch (task.end.kind) {
      case "date":
        end = parseGanttDate(meaning.dateFormat, task.end.text);
        break;
      case "duration": {
        const length = ganttDurationMs(task.end.text);
        end = length === null ? null : start + length;
        break;
      }
      case "until": {
        const starts = task.end.ids.map((id) => {
          const target = indexOfId.get(id);
          return target === undefined ? null : (resolve(target)?.start ?? null);
        });
        end = starts.includes(null) ? null : Math.min(...(starts as number[]));
        break;
      }
    }
    if (end === null) return null;
    const isManualEnd =
      task.end.kind === "date" &&
      parseGanttDate(GANTT_END_DATE_MANUAL_FORMAT, task.end.text) !== null;
    if (rules.tokens.size > 0 && !isManualEnd) {
      end = moveEndPastExcludedDays(rules, start, end);
      if (end === null) return null;
    }
    return { start, end };
  };
  return Array.from({ length: count }, (_, index) => resolve(index));
}

// Mermaid's `fixTaskDates`: walks the days after the start up to the end, and every excluded
// day found pushes the end one day later (so the walk goes on over the days it added).
function moveEndPastExcludedDays(
  rules: ExcludeRules,
  start: number,
  end: number,
): number | null {
  const limit = end + GANTT_MAX_EXCLUDE_DAYS * MS_PER_DAY;
  let moved = end;
  for (let day = start + MS_PER_DAY; day <= moved; day += MS_PER_DAY) {
    if (!isExcludedDay(rules, day)) continue;
    moved += MS_PER_DAY;
    if (moved > limit) return null;
  }
  return moved;
}

export interface MeaningProblem {
  readonly code:
    | "duplicateTaskIds"
    | "duplicateSectionNames"
    | "danglingReference"
    | "cyclicReference"
    | "firstTaskImplicitStart";
  readonly detail: string;
}

function referencedIds(task: GanttTaskMeaning): readonly string[] {
  return [
    ...(task.start.kind === "after" ? task.start.ids : []),
    ...(task.end.kind === "until" ? task.end.ids : []),
  ];
}

// The structural rules ganttEditability applies to a parse, applied to a meaning: an
// operation builds the meaning it promises and refuses before writing anything when that
// meaning could not be edited again.
export function findMeaningProblem(
  meaning: GanttMeaning,
): MeaningProblem | null {
  const ids = meaning.tasks.flatMap((task) =>
    task.id === null ? [] : [task.id],
  );
  if (new Set(ids).size !== ids.length) {
    return {
      code: "duplicateTaskIds",
      detail: "two tasks would have the same id",
    };
  }
  if (new Set(meaning.sections).size !== meaning.sections.length) {
    return {
      code: "duplicateSectionNames",
      detail: "two sections would have the same name",
    };
  }
  const known = new Set(ids);
  if (
    meaning.tasks.some((task) =>
      referencedIds(task).some((id) => !known.has(id)),
    )
  ) {
    return {
      code: "danglingReference",
      detail: "a reference would name a task that does not exist",
    };
  }
  if (meaning.tasks[0]?.start.kind === "implicit") {
    return {
      code: "firstTaskImplicitStart",
      detail: "the first task would have no start",
    };
  }
  const indexOfId = new Map(
    meaning.tasks.flatMap((task, index) =>
      task.id === null ? [] : [[task.id, index] as const],
    ),
  );
  const state = new Array<0 | 1 | 2>(meaning.tasks.length).fill(0);
  const visit = (index: number): boolean => {
    if (state[index] === 1) return true;
    if (state[index] === 2) return false;
    state[index] = 1;
    const task = meaning.tasks[index] as GanttTaskMeaning;
    const targets = referencedIds(task).map(
      (id) => indexOfId.get(id) as number,
    );
    if (task.start.kind === "implicit" && index > 0) targets.push(index - 1);
    for (const target of targets) if (visit(target)) return true;
    state[index] = 2;
    return false;
  };
  if (meaning.tasks.some((_, index) => visit(index))) {
    return {
      code: "cyclicReference",
      detail: "tasks would refer to each other in a circle",
    };
  }
  return null;
}

function same<T>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function describeDifferences(
  actual: GanttMeaning,
  expected: GanttMeaning,
): readonly string[] {
  const differences: string[] = [];
  if (actual.title !== expected.title) {
    differences.push(
      `title: expected ${JSON.stringify(expected.title)}, got ${JSON.stringify(actual.title)}`,
    );
  }
  if (actual.dateFormat !== expected.dateFormat) {
    differences.push(
      `dateFormat: expected ${expected.dateFormat}, got ${actual.dateFormat}`,
    );
  }
  if (!same(actual.sections, expected.sections)) {
    differences.push(
      `sections: expected ${JSON.stringify(expected.sections)}, got ${JSON.stringify(actual.sections)}`,
    );
  }
  if (actual.tasks.length !== expected.tasks.length) {
    differences.push(
      `task count: expected ${expected.tasks.length}, got ${actual.tasks.length}`,
    );
  }
  const shared = Math.min(actual.tasks.length, expected.tasks.length);
  for (let index = 0; index < shared; index += 1) {
    if (!same(actual.tasks[index], expected.tasks[index])) {
      differences.push(
        `task ${index}: expected ${JSON.stringify(expected.tasks[index])}, got ${JSON.stringify(actual.tasks[index])}`,
      );
    }
  }
  if (!same(actual.links, expected.links)) {
    differences.push(
      `links: expected ${JSON.stringify(expected.links)}, got ${JSON.stringify(actual.links)}`,
    );
  }
  if (expected.schedule !== undefined) {
    const schedule = resolveGanttSchedule(actual);
    if (!same(schedule, expected.schedule)) {
      differences.push(
        `schedule: expected ${JSON.stringify(expected.schedule)}, got ${JSON.stringify(schedule)}`,
      );
    }
  }
  if (!same(actual.settings, expected.settings)) {
    differences.push(
      `settings: expected ${JSON.stringify(expected.settings)}, got ${JSON.stringify(actual.settings)}`,
    );
  }
  return differences;
}

// Compares the meaning of a candidate with what the operation promised. Anything the parse
// could not classify rejects the candidate: an unreadable line might mean anything.
export function checkGanttMeaning(
  candidate: ParsedGantt,
  expected: GanttMeaning,
): DomainResult<void> {
  const editability = ganttEditability(candidate);
  if (!editability.editable) {
    return err(
      "diagramNotEditable",
      `candidate ${editability.reason}: ${editability.detail}`,
    );
  }
  const actual = ganttMeaningOf(candidate);
  if (actual === null) {
    return err("diagramNotEditable", "candidate has no meaning");
  }
  const differences = describeDifferences(actual, expected);
  return differences.length === 0
    ? ok(undefined)
    : err(
        "diagramMeaningMismatch",
        `meaningMismatch: ${differences.join("; ")}`,
      );
}
