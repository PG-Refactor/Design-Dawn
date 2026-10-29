import { type DomainResult, err, ok } from "../../shared/domain-result";
import { hasMarkupRewrite } from "../pie/pie-text";
import {
  GANTT_AUTO_ID_PATTERN,
  GANTT_BARE_KEYWORD_PATTERN,
  GANTT_COMMENT_MARK,
  GANTT_DIRECTIVE_MARK,
  GANTT_ID_PATTERN,
  GANTT_KEYWORD_LED_PATTERN,
  GANTT_OTHER_CLICK_PATTERN,
  GANTT_TAGS,
  type GanttDateFormat,
} from "./gantt-config";
import { isGanttDuration, parseGanttDate } from "./gantt-date";

// Text rules of the gantt editor. They mirror what Mermaid 12.1.0 does to a line before and
// while it reads it (docs/architecture.md §16.17), because a name, title or id is only safe to
// write if Mermaid reads back exactly what was written.

const UNUSUAL_WHITESPACE_PATTERN = /[^\S \t]/;
const TAB_CODE = 0x09;
const C0_CONTROL_MAX = 0x1f;
const DELETE_CODE = 0x7f;
const C1_CONTROL_MAX = 0x9f;
const WORD_SEPARATOR_PATTERN = /[\t ]+/;
const COMMENT_START = "%";
const FORBIDDEN_CHARACTER_PATTERN = /[#;]/;

// Whitespace other than a blank and a tab, and control characters: Mermaid's lexer treats
// several of them as separators, so a line that holds one cannot be read reliably.
export function hasUnusualCharacter(text: string): boolean {
  if (UNUSUAL_WHITESPACE_PATTERN.test(text)) return true;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (
      (code <= C0_CONTROL_MAX && code !== TAB_CODE) ||
      (code >= DELETE_CODE && code <= C1_CONTROL_MAX)
    ) {
      return true;
    }
  }
  return false;
}

// `%` as the first or second character of a word makes Mermaid's lexer treat the rest of the
// line as a comment (`5% rule` and `é%` lose their task; `ab%c` is fine).
export function hasCommentMarkWord(text: string): boolean {
  return text
    .trim()
    .split(WORD_SEPARATOR_PATTERN)
    .some((word) => word[0] === COMMENT_START || word[1] === COMMENT_START);
}

function refuse<T>(reason: string, detail: string): DomainResult<T> {
  return err("invalidDiagramOperation", `${reason}: ${detail}`);
}

// A title, a section name or a task name as one line of text.
function validateLineText(text: string, what: string): DomainResult<string> {
  if (text.trim() === "")
    return refuse("emptyText", `${what} must not be empty`);
  if (text !== text.trim()) {
    return refuse(
      "untrimmedText",
      `${what} must not start or end with a blank`,
    );
  }
  if (hasUnusualCharacter(text)) {
    return refuse(
      "controlCharacter",
      `${what} cannot hold a line break, tab or control character`,
    );
  }
  if (FORBIDDEN_CHARACTER_PATTERN.test(text)) {
    return refuse(
      "specialCharacter",
      `${what} cannot hold # or ; (a comment or a statement break)`,
    );
  }
  if (
    text.includes(GANTT_COMMENT_MARK) ||
    text.includes(GANTT_DIRECTIVE_MARK)
  ) {
    return refuse(
      "comment",
      `${what} cannot hold %% (a comment or a directive)`,
    );
  }
  if (hasCommentMarkWord(text)) {
    return refuse(
      "commentMark",
      `a word of ${what} starts or continues with % at its second character, which hides the line`,
    );
  }
  if (hasMarkupRewrite(text)) {
    return refuse(
      "markup",
      `Mermaid rewrites the quotes of markup-like text in ${what}`,
    );
  }
  return ok(text);
}

export function validateGanttTitle(title: string): DomainResult<string> {
  return validateLineText(title, "a title");
}

export function validateGanttSectionName(name: string): DomainResult<string> {
  return validateLineText(name, "a section name");
}

export function validateGanttTaskName(name: string): DomainResult<string> {
  const checked = validateLineText(name, "a task name");
  if (!checked.ok) return checked;
  if (name.includes(":")) {
    return refuse("colon", "a task name ends at the first colon");
  }
  if (
    GANTT_KEYWORD_LED_PATTERN.test(name) ||
    GANTT_BARE_KEYWORD_PATTERN.test(name) ||
    GANTT_OTHER_CLICK_PATTERN.test(name)
  ) {
    return refuse(
      "keywordLedName",
      "a name that starts with a statement keyword or a date would be read as that statement",
    );
  }
  return checked;
}

export function validateGanttTaskId(id: string): DomainResult<string> {
  if (!GANTT_ID_PATTERN.test(id)) {
    return refuse("invalidId", "an id uses only letters, digits, _ and -");
  }
  if ((GANTT_TAGS as readonly string[]).includes(id)) {
    return refuse(
      "tagWordId",
      "a status word would be read as a tag, not as an id",
    );
  }
  if (GANTT_AUTO_ID_PATTERN.test(id)) {
    return refuse(
      "autoIdShape",
      "task<number> is the id Mermaid gives a task without one",
    );
  }
  return ok(id);
}

export function validateGanttDateText(
  format: GanttDateFormat,
  text: string,
): DomainResult<string> {
  return parseGanttDate(format, text) === null
    ? refuse("invalidDate", `use a real date written as ${format}`)
    : ok(text);
}

export function validateGanttDurationText(text: string): DomainResult<string> {
  return isGanttDuration(text)
    ? ok(text)
    : refuse(
        "invalidDuration",
        "use digits and one unit of ms, s, m, h, d, w, M, y (for example 3d or 1.5h)",
      );
}
