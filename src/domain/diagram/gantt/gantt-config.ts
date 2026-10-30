// Syntax and policy values of the gantt editor. Every one of them was checked against
// Mermaid 12.1.0 (docs/architecture.md §16.17); nothing here is a guess about newer versions.

export const GANTT_HEADER_KEYWORD = "gantt";

export const GANTT_TAGS = [
  "active",
  "done",
  "crit",
  "milestone",
  "vert",
] as const;
export type GanttTag = (typeof GANTT_TAGS)[number];

// Mermaid stops at this size (its `maxTextSize` default), so a longer text cannot be drawn.
export const GANTT_MAX_SOURCE_LENGTH = 50_000;

// The `dateFormat` values the editor understands; for any other the whole chart is read-only
// because a date could not be checked, and Mermaid falls back to JavaScript's `Date` for text
// that does not match the format (engines differ on what that accepts).
export const GANTT_DATE_FORMATS = [
  "YYYY-MM-DD",
  "YYYY/MM/DD",
  "DD/MM/YYYY",
  "MM/DD/YYYY",
  "YYYY-MM-DD HH:mm",
] as const;
export type GanttDateFormat = (typeof GANTT_DATE_FORMATS)[number];

// Years the strict parser accepts: four digits, so no year below 1000 whose handling by
// Date.UTC (two-digit years) would differ from Mermaid's.
export const GANTT_MIN_YEAR = 1000;
export const GANTT_MAX_YEAR = 9999;

// `1d`, `2.5h`, `30m`: the only text Mermaid reads as a length. Anything else is silently a
// zero-length task.
export const GANTT_DURATION_PATTERN = /^(\d+(?:\.\d+)?)(ms|[Mdhmswy])$/;
export const GANTT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
// A generated id starts with a letter, so it is never mistaken for a number or a date.
export const GANTT_GENERATED_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
export const GANTT_GENERATED_ID_PREFIX = "gt";
// Mermaid names a task without an id `task<N>`; an explicit id of that shape would collide.
export const GANTT_AUTO_ID_PATTERN = /^task\d+$/;

export const GANTT_AFTER_KEYWORD = "after";
export const GANTT_UNTIL_KEYWORD = "until";
export const GANTT_SECTION_KEYWORD = "section";
export const GANTT_TITLE_KEYWORD = "title";
export const GANTT_CLICK_KEYWORD = "click";
export const GANTT_FIELD_SEPARATOR = ", ";

// Settings that take the rest of the line as their value (compared in lower case).
export const GANTT_VALUE_SETTING_KEYWORDS = [
  "dateformat",
  "axisformat",
  "tickinterval",
  "includes",
  "excludes",
  "todaymarker",
] as const;
export type GanttSettingKeyword =
  | (typeof GANTT_VALUE_SETTING_KEYWORDS)[number]
  | "weekday"
  | "weekend"
  | "inclusiveenddates";
export const GANTT_SETTING_PATTERN =
  /^(dateFormat|axisFormat|tickInterval|includes|excludes|todayMarker)[ \t](.*)$/i;
export const GANTT_WEEKDAY_PATTERN =
  /^weekday[ \t]+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)[ \t]*$/i;
export const GANTT_WEEKEND_PATTERN = /^weekend[ \t]+(friday|saturday)[ \t]*$/i;
export const GANTT_INCLUSIVE_END_DATES_PATTERN = /^inclusiveEndDates[ \t]*$/i;
export const GANTT_TITLE_PATTERN = /^(title|section)[ \t](.*)$/i;
// Only http(s) links: Mermaid rewrites other schemes (`javascript:` becomes `about:blank`) and
// normalises the rest, so the written text is not what it holds.
export const GANTT_CLICK_PATTERN =
  /^click[ \t]+(\S+)[ \t]+href[ \t]+"(https?:\/\/[^"\s]*)"[ \t]*$/i;
export const GANTT_TOP_AXIS_PATTERN = /^topAxis\b/i;
export const GANTT_ACCESSIBILITY_PATTERN =
  /^(?:accTitle\s*:|accDescr\s*[:{]|accDescription\s)/i;
export const GANTT_OTHER_CLICK_PATTERN = /^(?:click|call|href)\b/i;
// Mermaid reads `after a b` / `until a b`: ids separated by single blanks.
export const GANTT_AFTER_PATTERN =
  /^after +([A-Za-z0-9_-]+(?: +[A-Za-z0-9_-]+)*)$/;
export const GANTT_UNTIL_PATTERN =
  /^until +([A-Za-z0-9_-]+(?: +[A-Za-z0-9_-]+)*)$/;

export const GANTT_WEEKDAY_NAMES = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export const GANTT_WEEKENDS_TOKEN = "weekends";

// What Mermaid's lexer takes for something other than a task when a line starts with it
// (measured, §16.17): a name that starts like this would become that statement.
export const GANTT_KEYWORD_LED_PATTERN =
  /^(?:gantt\b|dateformat\s|inclusiveenddates\b|topaxis\b|axisformat\s|tickinterval\s|includes\s|excludes\s|todaymarker\s|weekday\s+\w+|weekend\s+(?:friday|saturday)\b|title\s|section\s|click\s|call\s|href\s+"|acc(?:title|descr)\s*:|accdescr\s*\{|accdescription\s|\d{4}-\d\d-\d\d\b)/i;
// A line that starts with one of these words but has no usable value: its empty value would
// swallow the next line (`\s` matches the line break).
export const GANTT_BARE_KEYWORD_PATTERN =
  /^(?:dateformat|axisformat|tickinterval|includes|excludes|todaymarker|title|section|weekday|weekend|gantt)\b/i;

export const GANTT_COMMENT_MARK = "%%";
export const GANTT_DIRECTIVE_MARK = "%%{";

export const GANTT_DEFAULT_INDENT = "    ";
export const GANTT_DEFAULT_LINE_ENDING = "\n";

// ---- Tier 2 (docs/architecture.md §16.17.2) ----

export const GANTT_AXIS_FORMAT_KEYWORD = "axisFormat";
export const GANTT_EXCLUDES_KEYWORD = "excludes";
export const GANTT_WEEKEND_KEYWORD = "weekend";
export const GANTT_EXCLUDE_TOKEN_SEPARATOR = ", ";
export const GANTT_EXCLUDE_TOKEN_PATTERN = /[\s,]+/;
// An `excludes` date token: Mermaid compares it with `YYYY-MM-DD` of each day, whatever the
// chart's dateFormat is.
export const GANTT_EXCLUDE_DATE_FORMAT: GanttDateFormat = "YYYY-MM-DD";
// ISO weekday numbers (Monday = 1) of the day a `weekend` statement starts on; the weekend is
// that day and the next. Mermaid's default weekend starts on Saturday.
export const GANTT_WEEKEND_START_DAYS = { friday: 5, saturday: 6 } as const;
export const GANTT_DEFAULT_WEEKEND_START_DAY =
  GANTT_WEEKEND_START_DAYS.saturday;
// Mermaid stops moving an end date past excluded days after this many days.
export const GANTT_MAX_EXCLUDE_DAYS = 10_000;
// The conversions of d3-time-format (what `axisFormat` is handed to), each written `%` plus an
// optional padding modifier plus one of these letters. `%%` is not accepted (the reader treats
// `%%` as a comment mark).
export const GANTT_AXIS_CONVERSIONS = "aAbBcdefgGHIjLmMpqQsSuUVwWxXyYZ";
export const GANTT_AXIS_PAD_MODIFIERS = "-_0";
export const GANTT_AXIS_FORMAT_MAX_LENGTH = 100;
export const GANTT_AXIS_CONVERSION_MARK = "%";
// A link target: `http(s)://` and then characters that need no escaping in the quoted
// `click` form. `#`, `;` and `%` end or change what Mermaid's lexer reads, so they are not
// accepted (the reader refuses such a line).
export const GANTT_LINK_URL_PATTERN = /^https?:\/\/[^"\s#;%]+$/;
export const GANTT_LINK_URL_MAX_LENGTH = 2000;
export const GANTT_LINK_KEYWORD = "href";
// Mermaid treats an end that is a date written as `YYYY-MM-DD` as final: `excludes` does not
// push it later, whatever the chart's dateFormat is.
export const GANTT_END_DATE_MANUAL_FORMAT: GanttDateFormat = "YYYY-MM-DD";
