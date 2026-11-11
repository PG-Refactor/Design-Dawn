// Search and replace in a Block's text, by the same rules the Rust search uses: matches lie
// within one line, upper and lower case are equal unless `matchCase`, and offsets are in
// characters (code points) of the original line. The text is found as written, or, with
// `regex`, as a regular expression (JavaScript syntax here, Rust's `regex` for Documents
// the app has not opened; the common part, without look-around and back-references, means
// the same in both). An empty match marks no text and is skipped.

export interface TextQuery {
  readonly text: string;
  readonly matchCase: boolean;
  readonly regex: boolean;
}

export interface TextMatch {
  // 1-based line.
  readonly line: number;
  // Offsets in characters (code points) within the line.
  readonly start: number;
  readonly length: number;
  readonly lineText: string;
}

// Which occurrence: its 1-based line and its 0-based place among the occurrences of that
// line, as `findMatches` lists them. (A position in characters is not used: the Project
// search shows a cut excerpt of a long line, whose offsets are not the line's.)
export interface OccurrenceAt {
  readonly line: number;
  readonly ordinal: number;
}

export interface Replaced {
  readonly text: string;
  readonly count: number;
}

const LINE_BREAK = /\r?\n/;
const LINE_WITH_BREAK = /[^\n]*(?:\n|$)/g;
const TRAILING_BREAK = /\r?\n$/;

// One occurrence in a line: offsets in code points, and for a pattern what it captured
// (for `$1` in the replacement).
interface LineOccurrence {
  readonly start: number;
  readonly length: number;
  readonly captured: RegExpExecArray | null;
}

type LineMatcher = (line: string) => LineOccurrence[];

function foldCharacters(text: string, matchCase: boolean): string[] {
  return [...text].map((character) =>
    matchCase ? character : ([...character.toLowerCase()][0] ?? character),
  );
}

function plainMatcher(text: string, matchCase: boolean): LineMatcher {
  const needle = foldCharacters(text, matchCase);
  return (line) => {
    const haystack = foldCharacters(line, matchCase);
    const found: LineOccurrence[] = [];
    if (needle.length === 0 || needle.length > haystack.length) return found;
    let start = 0;
    while (start + needle.length <= haystack.length) {
      let equal = true;
      for (let index = 0; index < needle.length; index += 1) {
        if (haystack[start + index] !== needle[index]) {
          equal = false;
          break;
        }
      }
      if (equal) {
        found.push({ start, length: needle.length, captured: null });
        start += needle.length;
      } else {
        start += 1;
      }
    }
    return found;
  };
}

const codePoints = (text: string) => [...text].length;

function patternMatcher(pattern: RegExp): LineMatcher {
  return (line) =>
    [...line.matchAll(pattern)]
      .filter((found) => found[0].length > 0)
      .map((found) => ({
        start: codePoints(line.slice(0, found.index)),
        length: codePoints(found[0]),
        captured: found,
      }));
}

// The query as a pattern, or why it is not one; null for a plain query.
export function queryPattern(
  query: TextQuery,
):
  | { readonly ok: true; readonly pattern: RegExp | null }
  | { readonly ok: false } {
  if (!query.regex) return { ok: true, pattern: null };
  try {
    return {
      ok: true,
      pattern: new RegExp(query.text, query.matchCase ? "gu" : "giu"),
    };
  } catch {
    return { ok: false };
  }
}

// A query that is not a valid pattern (or is empty) finds nothing.
function matcherOf(query: TextQuery): LineMatcher | null {
  if (query.text.length === 0) return null;
  const compiled = queryPattern(query);
  if (!compiled.ok) return null;
  return compiled.pattern === null
    ? plainMatcher(query.text, query.matchCase)
    : patternMatcher(compiled.pattern);
}

export function isValidQuery(query: TextQuery): boolean {
  return queryPattern(query).ok;
}

export function findMatches(text: string, query: TextQuery): TextMatch[] {
  const matcher = matcherOf(query);
  if (matcher === null) return [];
  const matches: TextMatch[] = [];
  text.split(LINE_BREAK).forEach((lineText, index) => {
    for (const { start, length } of matcher(lineText)) {
      matches.push({ line: index + 1, start, length, lineText });
    }
  });
  return matches;
}

const REPLACEMENT_TOKEN = /\$(\$|&|\d{1,2}|<([^>]*)>)/g;

// What replaces one occurrence: the replacement as written for a plain query; for a pattern,
// with `$&` (the match), `$1`..`$99`, `$<name>` and `$$` filled in, as JavaScript's
// `String.replace` does.
function replacementFor(
  replacement: string,
  captured: RegExpExecArray | null,
): string {
  if (captured === null) return replacement;
  return replacement.replace(
    REPLACEMENT_TOKEN,
    (token, kind: string, name: string | undefined) => {
      if (kind === "$") return "$";
      if (kind === "&") return captured[0];
      if (name !== undefined) return captured.groups?.[name] ?? "";
      const group = Number(kind);
      return group > 0 && group < captured.length
        ? (captured[group] ?? "")
        : token;
    },
  );
}

function linesOf(text: string): string[] {
  return text.match(LINE_WITH_BREAK) ?? [text];
}

function splitBreak(lineWithBreak: string): {
  readonly lineText: string;
  readonly lineBreak: string;
} {
  const lineText = lineWithBreak.replace(TRAILING_BREAK, "");
  return { lineText, lineBreak: lineWithBreak.slice(lineText.length) };
}

function replaceInLine(
  lineText: string,
  occurrences: readonly LineOccurrence[],
  replacement: string,
): string {
  const characters = [...lineText];
  let result = "";
  let cursor = 0;
  for (const occurrence of occurrences) {
    result +=
      characters.slice(cursor, occurrence.start).join("") +
      replacementFor(replacement, occurrence.captured);
    cursor = occurrence.start + occurrence.length;
  }
  return result + characters.slice(cursor).join("");
}

// Every occurrence replaced. Line breaks are untouched (a match never spans lines).
export function replaceAll(
  text: string,
  query: TextQuery,
  replacement: string,
): Replaced {
  const matcher = matcherOf(query);
  if (matcher === null) return { text, count: 0 };
  let count = 0;
  const replaced = linesOf(text)
    .map((lineWithBreak) => {
      const { lineText, lineBreak } = splitBreak(lineWithBreak);
      const occurrences = matcher(lineText);
      count += occurrences.length;
      return occurrences.length === 0
        ? lineWithBreak
        : replaceInLine(lineText, occurrences, replacement) + lineBreak;
    })
    .join("");
  return count === 0 ? { text, count: 0 } : { text: replaced, count };
}

function occurrenceAt(
  text: string,
  query: TextQuery,
  at: OccurrenceAt,
): {
  readonly lines: string[];
  readonly lineText: string;
  readonly lineBreak: string;
  readonly occurrence: LineOccurrence;
} | null {
  const matcher = matcherOf(query);
  const lines = linesOf(text);
  const lineWithBreak = lines[at.line - 1];
  if (matcher === null || lineWithBreak === undefined) return null;
  const { lineText, lineBreak } = splitBreak(lineWithBreak);
  const occurrence = matcher(lineText)[at.ordinal];
  return occurrence === undefined
    ? null
    : { lines, lineText, lineBreak, occurrence };
}

// Only the occurrence at `at` replaced. Count 0 when the line no longer has it.
export function replaceOccurrence(
  text: string,
  query: TextQuery,
  replacement: string,
  at: OccurrenceAt,
): Replaced {
  const found = occurrenceAt(text, query, at);
  if (found === null) return { text, count: 0 };
  const { lines, lineText, lineBreak, occurrence } = found;
  const before = lines.slice(0, at.line - 1).join("");
  const after = lines.slice(at.line).join("");
  return {
    text:
      before +
      replaceInLine(lineText, [occurrence], replacement) +
      lineBreak +
      after,
    count: 1,
  };
}

// Where the occurrence at `at` is in the whole text, in UTF-16 code units (what a text
// field's selection uses); null when the line no longer has it.
export function occurrenceRange(
  text: string,
  query: TextQuery,
  at: OccurrenceAt,
): { readonly start: number; readonly end: number } | null {
  const found = occurrenceAt(text, query, at);
  if (found === null) return null;
  const { lines, lineText, occurrence } = found;
  const characters = [...lineText];
  const lineStart = lines.slice(0, at.line - 1).join("").length;
  const before = characters.slice(0, occurrence.start).join("").length;
  const matched = characters
    .slice(occurrence.start, occurrence.start + occurrence.length)
    .join("").length;
  return { start: lineStart + before, end: lineStart + before + matched };
}
