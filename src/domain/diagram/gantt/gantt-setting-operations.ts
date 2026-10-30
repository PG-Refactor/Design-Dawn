import { type DomainResult, ok } from "../../shared/domain-result";
import type { TextEdit } from "../text-edit";
import {
  GANTT_AXIS_FORMAT_KEYWORD,
  GANTT_EXCLUDE_DATE_FORMAT,
  GANTT_EXCLUDE_TOKEN_SEPARATOR,
  GANTT_EXCLUDES_KEYWORD,
  GANTT_SETTING_PREFIX_PATTERN,
  GANTT_WEEKDAY_NAMES,
  GANTT_WEEKENDS_TOKEN,
  type GanttSettingKeyword,
} from "./gantt-config";
import { parseGanttDate } from "./gantt-date";
import {
  deleteLinesEdits,
  indentOf,
  insertLineAfter,
} from "./gantt-edit-lines";
import { excludedWeekdayNames, weekendStartDayOf } from "./gantt-excludes";
import {
  type GanttMeaning,
  type GanttSettingMeaning,
  resolveGanttSchedule,
} from "./gantt-meaning";
import {
  finish,
  type GanttOperationPlan,
  type PreparedGantt,
  prepare,
  readBack,
  refuse,
} from "./gantt-operation-support";
import { validateGanttAxisFormat } from "./gantt-text";
import type { GanttLine } from "./gantt-types";

// Settings of the chart that Tier 2 edits: `axisFormat` and `excludes`. A setting is one line `keyword value`; the value runs to the end of the line.
// `excludes` also moves dates, so its plans promise the resolved date of every task.

type EditableSetting =
  | typeof GANTT_AXIS_FORMAT_KEYWORD
  | typeof GANTT_EXCLUDES_KEYWORD;

const KEYWORD_OF: Readonly<Record<EditableSetting, GanttSettingKeyword>> = {
  axisFormat: "axisformat",
  excludes: "excludes",
};

// Which of several lines of one setting is the one Mermaid reads: for `axisFormat` the last
// statement replaces the earlier ones, for `excludes` the statements add up (the first line
// is kept and takes the whole value).
const KEPT_LINE: Readonly<Record<EditableSetting, "first" | "last">> = {
  axisFormat: "last",
  excludes: "first",
};

interface SettingSite {
  // Index into `parsed.settings`.
  readonly position: number;
  readonly line: GanttLine;
}

function sitesOf(
  prepared: PreparedGantt,
  setting: EditableSetting,
): readonly SettingSite[] {
  const { parsed } = prepared;
  return parsed.settings.flatMap((entry, position) =>
    entry.keyword === KEYWORD_OF[setting]
      ? [{ position, line: parsed.lines[entry.lineIndex] as GanttLine }]
      : [],
  );
}

// Writes `value` as the only line of the setting: replaces the value on the kept line, removes
// the other lines, or adds a line under `dateFormat` when there is none.
function writeSetting(
  prepared: PreparedGantt,
  setting: EditableSetting,
  value: string,
): {
  readonly edits: readonly TextEdit[];
  readonly settings: readonly GanttSettingMeaning[];
} {
  const { parsed, meaning } = prepared;
  const sites = sitesOf(prepared, setting);
  const written: GanttSettingMeaning = { keyword: KEYWORD_OF[setting], value };
  if (sites.length === 0) {
    const dateFormatPosition = parsed.settings.findIndex(
      (entry) => entry.keyword === "dateformat",
    );
    const anchor = parsed.settings[dateFormatPosition]?.lineIndex ?? 0;
    const settings = [...meaning.settings];
    settings.splice(dateFormatPosition + 1, 0, written);
    return {
      edits: [
        insertLineAfter(
          parsed,
          anchor,
          `${indentOf(parsed.lines[anchor])}${setting} ${value}`,
        ),
      ],
      settings,
    };
  }
  const kept =
    KEPT_LINE[setting] === "first" ? sites[0] : sites[sites.length - 1];
  const keptSite = kept as SettingSite;
  const edits: TextEdit[] = [];
  const valueStart =
    keptSite.line.start +
    (GANTT_SETTING_PREFIX_PATTERN.exec(keptSite.line.text)?.[0].length ?? 0);
  const current = meaning.settings[keptSite.position] as GanttSettingMeaning;
  if (current.value !== value) {
    edits.push({ start: valueStart, end: keptSite.line.end, text: value });
  }
  const others = sites.filter((site) => site !== keptSite);
  edits.push(
    ...deleteLinesEdits(parsed, new Set(others.map((site) => site.line.index))),
  );
  const removed = new Set(others.map((site) => site.position));
  const settings = meaning.settings
    .map((entry, position) =>
      position === keptSite.position ? written : entry,
    )
    .filter((_, position) => !removed.has(position));
  return { edits, settings };
}

export function setAxisFormat(
  source: string,
  format: string,
): DomainResult<GanttOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const checked = validateGanttAxisFormat(format);
  if (!checked.ok) return checked;
  const { edits, settings } = writeSetting(
    prepared.value,
    GANTT_AXIS_FORMAT_KEYWORD,
    format,
  );
  const expected: GanttMeaning = { ...prepared.value.meaning, settings };
  const planned = finish(edits, expected);
  if (!planned.ok) return planned;
  const verdict = readBack(source, edits, expected);
  return verdict.ok ? planned : verdict;
}

const WEEKDAY_NAMES: readonly string[] = GANTT_WEEKDAY_NAMES;

function checkExcludeTokens(
  tokens: readonly string[],
): DomainResult<readonly string[]> {
  if (tokens.length === 0) {
    return refuse(
      "noExcludeTokens",
      "name at least one day, or clear excludes",
    );
  }
  const normalized: string[] = [];
  for (const token of tokens) {
    const lower = token.trim().toLowerCase();
    const isKnown =
      lower === GANTT_WEEKENDS_TOKEN ||
      WEEKDAY_NAMES.includes(lower) ||
      parseGanttDate(GANTT_EXCLUDE_DATE_FORMAT, lower) !== null;
    if (!isKnown) {
      return refuse(
        "unknownExcludeToken",
        `${JSON.stringify(token)} is not weekends, a weekday name or a date written as ${GANTT_EXCLUDE_DATE_FORMAT}`,
      );
    }
    if (normalized.includes(lower)) {
      return refuse("duplicateExcludeToken", `${lower} is named twice`);
    }
    normalized.push(lower);
  }
  return ok(normalized);
}

// The promise of an `excludes` change: every task lands where the editor's resolver says.
// When the resolver cannot compute a task's dates before or after, the change is refused:
// the editor would be guessing where `excludes` moves it.
function planExcludes(
  prepared: PreparedGantt,
  edits: readonly TextEdit[],
  settings: readonly GanttSettingMeaning[],
): DomainResult<GanttOperationPlan> {
  const { meaning } = prepared;
  const candidate: GanttMeaning = { ...meaning, settings };
  const before = resolveGanttSchedule(meaning);
  const after = resolveGanttSchedule(candidate);
  const unknown = [...before.keys()].find(
    (index) => before[index] === null || after[index] === null,
  );
  if (unknown !== undefined) {
    return refuse(
      "unknownDates",
      `the editor cannot compute the dates of task ${unknown}, so it cannot tell how excludes moves them`,
    );
  }
  const expected: GanttMeaning = { ...candidate, schedule: after };
  const planned = finish(edits, expected);
  if (!planned.ok) return planned;
  const verdict = readBack(prepared.parsed.source, edits, expected);
  return verdict.ok ? planned : verdict;
}

export function setExcludes(
  source: string,
  tokens: readonly string[],
): DomainResult<GanttOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const checked = checkExcludeTokens(tokens);
  if (!checked.ok) return checked;
  const value = checked.value.join(GANTT_EXCLUDE_TOKEN_SEPARATOR);
  const { edits, settings } = writeSetting(
    prepared.value,
    GANTT_EXCLUDES_KEYWORD,
    value,
  );
  const covered = excludedWeekdayNames(
    checked.value,
    weekendStartDayOf(settings),
  );
  if (covered.size === GANTT_WEEKDAY_NAMES.length) {
    return refuse(
      "allDaysExcluded",
      "Mermaid cannot place a task when all seven days are excluded",
    );
  }
  return planExcludes(prepared.value, edits, settings);
}

export function clearExcludes(
  source: string,
): DomainResult<GanttOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const sites = sitesOf(prepared.value, GANTT_EXCLUDES_KEYWORD);
  if (sites.length === 0) {
    return refuse("noExcludes", "the chart has no excludes statement");
  }
  const removed = new Set(sites.map((site) => site.position));
  return planExcludes(
    prepared.value,
    deleteLinesEdits(
      prepared.value.parsed,
      new Set(sites.map((site) => site.line.index)),
    ),
    prepared.value.meaning.settings.filter(
      (_, position) => !removed.has(position),
    ),
  );
}
