import {
  GANTT_DEFAULT_WEEKEND_START_DAY,
  GANTT_EXCLUDE_DATE_FORMAT,
  GANTT_EXCLUDE_TOKEN_PATTERN,
  GANTT_EXCLUDES_KEYWORD,
  GANTT_WEEKDAY_NAMES,
  GANTT_WEEKEND_KEYWORD,
  GANTT_WEEKEND_START_DAYS,
  GANTT_WEEKENDS_TOKEN,
  type GanttDateFormat,
} from "./gantt-config";
import { formatGanttDate } from "./gantt-date";

// How Mermaid 12.1.0 decides that a day is excluded (`isInvalidDate` in its gantt db), for
// the part of it the editor models: the `weekends` token and weekday names (both with the
// `weekend` statement), and date tokens written as `YYYY-MM-DD` or in the chart's dateFormat.
// `includes` overrides exclusion and is not modelled (the schedule is then unknown).

export interface ExcludeSetting {
  readonly keyword: string;
  readonly value: string;
}

const ISO_WEEKDAY_OF_UTC_DAY = [7, 1, 2, 3, 4, 5, 6] as const;

// Mermaid lower-cases the tokens and splits on blanks and commas; several `excludes`
// statements add up.
export function excludeTokensOf(
  settings: readonly ExcludeSetting[],
): readonly string[] {
  return settings
    .filter((setting) => setting.keyword === GANTT_EXCLUDES_KEYWORD)
    .flatMap((setting) =>
      setting.value
        .toLowerCase()
        .split(GANTT_EXCLUDE_TOKEN_PATTERN)
        .filter((token) => token !== ""),
    );
}

// The last `weekend` statement wins.
export function weekendStartDayOf(settings: readonly ExcludeSetting[]): number {
  const weekend = settings.filter(
    (setting) => setting.keyword === GANTT_WEEKEND_KEYWORD,
  );
  const last = weekend[weekend.length - 1]?.value;
  return last === "friday"
    ? GANTT_WEEKEND_START_DAYS.friday
    : GANTT_DEFAULT_WEEKEND_START_DAY;
}

function weekdayName(isoWeekday: number): string {
  return GANTT_WEEKDAY_NAMES[isoWeekday - 1] as string;
}

// The weekday names the tokens remove (`weekends` expands to the two weekend days).
export function excludedWeekdayNames(
  tokens: readonly string[],
  weekendStartDay: number,
): ReadonlySet<string> {
  const days = new Set<string>();
  for (const token of tokens) {
    if (token === GANTT_WEEKENDS_TOKEN) {
      days.add(weekdayName(weekendStartDay));
      days.add(weekdayName(weekendStartDay + 1));
    } else if ((GANTT_WEEKDAY_NAMES as readonly string[]).includes(token)) {
      days.add(token);
    }
  }
  return days;
}

export interface ExcludeRules {
  readonly tokens: ReadonlySet<string>;
  readonly weekendStartDay: number;
  readonly dateFormat: GanttDateFormat;
}

export function excludeRulesOf(
  settings: readonly ExcludeSetting[],
  dateFormat: GanttDateFormat,
): ExcludeRules {
  return {
    tokens: new Set(excludeTokensOf(settings)),
    weekendStartDay: weekendStartDayOf(settings),
    dateFormat,
  };
}

// Is the day that starts or contains `value` (face-value milliseconds) excluded?
export function isExcludedDay(rules: ExcludeRules, value: number): boolean {
  const isoWeekday = ISO_WEEKDAY_OF_UTC_DAY[
    new Date(value).getUTCDay()
  ] as number;
  if (
    rules.tokens.has(GANTT_WEEKENDS_TOKEN) &&
    (isoWeekday === rules.weekendStartDay ||
      isoWeekday === rules.weekendStartDay + 1)
  ) {
    return true;
  }
  if (rules.tokens.has(weekdayName(isoWeekday))) return true;
  return (
    rules.tokens.has(formatGanttDate(rules.dateFormat, value).toLowerCase()) ||
    rules.tokens.has(formatGanttDate(GANTT_EXCLUDE_DATE_FORMAT, value))
  );
}
