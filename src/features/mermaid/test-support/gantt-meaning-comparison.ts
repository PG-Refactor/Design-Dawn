// TEST ONLY. Brings the domain's GanttMeaning and Mermaid's gantt db to one comparable form
// and names the first difference. The db knows the tasks, sections, flags, links and the
// settings; it does not know which setting line wrote a value, so both sides are reduced to
// the value that is in force.
import type { GanttMeaning } from "../../../domain/diagram/gantt/gantt-meaning";
import { type DbGantt, type DbTask, hasExplicitId } from "./mermaid-gantt-db";

const TOKEN_SEPARATOR = /[\s,]+/;
const DEFAULT_WEEKDAY = "sunday";

interface ComparableTask {
  readonly section: string;
  readonly name: string;
  readonly id: string | null;
  readonly tags: readonly string[];
  readonly start: string;
  readonly end: string;
}

export interface ComparableGantt {
  readonly title: string;
  readonly dateFormat: string;
  readonly sections: readonly string[];
  readonly tasks: readonly ComparableTask[];
  readonly links: readonly string[];
  readonly settings: Readonly<Record<string, string>>;
}

const sortedUnique = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort();

function tokensOf(values: readonly string[]): string {
  return JSON.stringify(
    sortedUnique(
      values.flatMap((value) =>
        value
          .toLowerCase()
          .split(TOKEN_SEPARATOR)
          .filter((token) => token !== ""),
      ),
    ),
  );
}

export function comparableOfMeaning(meaning: GanttMeaning): ComparableGantt {
  const valuesOf = (keyword: string) =>
    meaning.settings
      .filter((setting) => setting.keyword === keyword)
      .map((setting) => setting.value);
  const last = (keyword: string) => valuesOf(keyword).at(-1) ?? "";
  return {
    title: meaning.title,
    dateFormat: meaning.dateFormat,
    sections: meaning.sections,
    tasks: meaning.tasks.map((task) => ({
      section: task.section,
      name: task.name,
      id: task.id,
      tags: task.tags,
      start:
        task.start.kind === "implicit"
          ? "prev"
          : task.start.kind === "date"
            ? task.start.text
            : `after ${task.start.ids.join(" ")}`,
      end:
        task.end.kind === "until"
          ? `until ${task.end.ids.join(" ")}`
          : task.end.text,
    })),
    // Mermaid normalises a link (a bare host gets a trailing slash).
    links: meaning.links
      .map((link) => `${link.id}=${new URL(link.url).href}`)
      .sort(),
    settings: {
      axisFormat: last("axisformat"),
      tickInterval: last("tickinterval"),
      todayMarker: last("todaymarker"),
      excludes: tokensOf(valuesOf("excludes")),
      includes: tokensOf(valuesOf("includes")),
      weekday: last("weekday") === "" ? DEFAULT_WEEKDAY : last("weekday"),
      inclusive: String(
        meaning.settings.some(
          (setting) => setting.keyword === "inclusiveenddates",
        ),
      ),
    },
  };
}

function startOf(task: DbTask): string {
  if (task.startKind === "prevTaskEnd") return "prev";
  return task.startData.replace(/ +/g, " ");
}

// Null when Mermaid could not compile the tasks.
export function comparableOfDb(db: DbGantt): ComparableGantt | null {
  if (db.tasks === null) return null;
  return {
    title: db.title,
    dateFormat: db.dateFormat.trim(),
    sections: db.sections,
    tasks: db.tasks.map((task) => ({
      section: task.section,
      name: task.name,
      id: hasExplicitId(task.rawData) ? task.id : null,
      tags: task.flags,
      start: startOf(task),
      end: task.endData,
    })),
    links: db.links.map(([id, url]) => `${id}=${url}`).sort(),
    settings: {
      axisFormat: db.axisFormat.trim(),
      tickInterval: db.tickInterval.trim(),
      todayMarker: db.todayMarker.trim(),
      excludes: tokensOf(db.excludes),
      includes: tokensOf(db.includes),
      weekday: db.weekday,
      inclusive: String(db.inclusive),
    },
  };
}

export function firstGanttDifference(
  actual: ComparableGantt,
  expected: ComparableGantt,
): string | null {
  for (const key of ["title", "dateFormat"] as const) {
    if (actual[key] !== expected[key]) {
      return `${key}: ${JSON.stringify(actual[key])} vs ${JSON.stringify(expected[key])}`;
    }
  }
  for (const key of ["sections", "links"] as const) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) {
      return `${key}: ${JSON.stringify(actual[key])} vs ${JSON.stringify(expected[key])}`;
    }
  }
  if (actual.tasks.length !== expected.tasks.length) {
    return `task count ${actual.tasks.length} vs ${expected.tasks.length}`;
  }
  for (let index = 0; index < actual.tasks.length; index += 1) {
    if (
      JSON.stringify(actual.tasks[index]) !==
      JSON.stringify(expected.tasks[index])
    ) {
      return `task ${index}: ${JSON.stringify(actual.tasks[index])} vs ${JSON.stringify(expected.tasks[index])}`;
    }
  }
  if (JSON.stringify(actual.settings) !== JSON.stringify(expected.settings)) {
    return `settings: ${JSON.stringify(actual.settings)} vs ${JSON.stringify(expected.settings)}`;
  }
  return null;
}
