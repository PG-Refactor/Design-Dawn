import {
  GANTT_DATE_FORMATS,
  GANTT_DURATION_PATTERN,
  GANTT_MAX_YEAR,
  GANTT_MIN_YEAR,
  type GanttDateFormat,
} from "./gantt-config";

// Dates of the gantt editor. Mermaid validates a date with the chart's `dateFormat` and,
// when that fails, falls back to JavaScript's `new Date(text)`, which accepts text no
// format describes (`2024-02-30` becomes March 1st in V8). The editor therefore checks dates
// itself, strictly, for the formats it supports, and refuses everything else.
//
// A date is held as the milliseconds of its face value read as UTC: only the calendar
// fields matter, no time zone is applied.

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;
const MAX_HOUR = 23;
const MAX_MINUTE = 59;
const MONTH_COUNT = 12;
const PAD_TWO = 2;
const PAD_FOUR = 4;

interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

type FieldOrder = readonly [
  "year" | "month" | "day",
  ...("year" | "month" | "day")[],
];

interface FormatShape {
  readonly pattern: RegExp;
  readonly order: FieldOrder;
  readonly hasTime: boolean;
}

const FORMAT_SHAPES: Readonly<Record<GanttDateFormat, FormatShape>> = {
  "YYYY-MM-DD": {
    pattern: /^(\d{4})-(\d{2})-(\d{2})$/,
    order: ["year", "month", "day"],
    hasTime: false,
  },
  "YYYY/MM/DD": {
    pattern: /^(\d{4})\/(\d{2})\/(\d{2})$/,
    order: ["year", "month", "day"],
    hasTime: false,
  },
  "DD/MM/YYYY": {
    pattern: /^(\d{2})\/(\d{2})\/(\d{4})$/,
    order: ["day", "month", "year"],
    hasTime: false,
  },
  "MM/DD/YYYY": {
    pattern: /^(\d{2})\/(\d{2})\/(\d{4})$/,
    order: ["month", "day", "year"],
    hasTime: false,
  },
  "YYYY-MM-DD HH:mm": {
    pattern: /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/,
    order: ["year", "month", "day"],
    hasTime: true,
  },
};

export function asGanttDateFormat(text: string): GanttDateFormat | null {
  const trimmed = text.trim();
  return GANTT_DATE_FORMATS.find((format) => format === trimmed) ?? null;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function partsOf(format: GanttDateFormat, text: string): DateParts | null {
  const shape = FORMAT_SHAPES[format];
  const match = shape.pattern.exec(text);
  if (match === null) return null;
  const fields: Record<string, number> = {};
  shape.order.forEach((name, position) => {
    fields[name] = Number(match[position + 1]);
  });
  return {
    year: fields.year as number,
    month: fields.month as number,
    day: fields.day as number,
    hour: shape.hasTime ? Number(match[4]) : 0,
    minute: shape.hasTime ? Number(match[5]) : 0,
  };
}

// The milliseconds of the date's face value, or null when the text is not a real calendar
// date in this format.
export function parseGanttDate(
  format: GanttDateFormat,
  text: string,
): number | null {
  const parts = partsOf(format, text);
  if (parts === null) return null;
  if (parts.year < GANTT_MIN_YEAR || parts.year > GANTT_MAX_YEAR) return null;
  if (parts.month < 1 || parts.month > MONTH_COUNT) return null;
  if (parts.hour > MAX_HOUR || parts.minute > MAX_MINUTE) return null;
  const value = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  const check = new Date(value);
  // Date.UTC rolls an impossible day (Feb 30) into the next month; a real date survives.
  if (
    check.getUTCMonth() !== parts.month - 1 ||
    check.getUTCDate() !== parts.day
  ) {
    return null;
  }
  return value;
}

export function isGanttDateText(
  format: GanttDateFormat,
  text: string,
): boolean {
  return parseGanttDate(format, text) !== null;
}

export function formatGanttDate(
  format: GanttDateFormat,
  value: number,
): string {
  const date = new Date(value);
  const year = pad(date.getUTCFullYear(), PAD_FOUR);
  const month = pad(date.getUTCMonth() + 1, PAD_TWO);
  const day = pad(date.getUTCDate(), PAD_TWO);
  switch (format) {
    case "YYYY-MM-DD":
      return `${year}-${month}-${day}`;
    case "YYYY/MM/DD":
      return `${year}/${month}/${day}`;
    case "DD/MM/YYYY":
      return `${day}/${month}/${year}`;
    case "MM/DD/YYYY":
      return `${month}/${day}/${year}`;
    case "YYYY-MM-DD HH:mm":
      return `${year}-${month}-${day} ${pad(date.getUTCHours(), PAD_TWO)}:${pad(date.getUTCMinutes(), PAD_TWO)}`;
  }
}

export function isGanttDuration(text: string): boolean {
  return GANTT_DURATION_PATTERN.test(text);
}

const FIXED_UNIT_MS: Readonly<Record<string, number>> = {
  m: MS_PER_MINUTE,
  h: MS_PER_HOUR,
  d: MS_PER_DAY,
  w: MS_PER_WEEK,
};

// The length in milliseconds of a duration that is a whole number of weeks, days, hours or
// minutes. Months and years vary in length, Mermaid rounds fractional days and weeks to whole
// ones, and it measurably ignores seconds and milliseconds (`10s` and `500ms` end where the
// task starts, §16.17); the editor does not predict those and returns null.
export function ganttDurationMs(text: string): number | null {
  const match = GANTT_DURATION_PATTERN.exec(text);
  if (match === null) return null;
  const [, amount, unit] = match;
  const length = FIXED_UNIT_MS[unit as string];
  if (length === undefined || (amount as string).includes(".")) return null;
  return Number(amount) * length;
}
