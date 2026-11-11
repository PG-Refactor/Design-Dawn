// Plain-text search and replace in a Block's text, the same rules the Rust search uses:
// every non-overlapping occurrence, upper and lower case equal unless `matchCase`, compared
// character by character so offsets are those of the original text.

export interface TextMatch {
  // 1-based line.
  readonly line: number;
  // Offsets in characters (code points) within the line.
  readonly start: number;
  readonly length: number;
  readonly lineText: string;
}

const LINE_BREAK = /\r?\n/;

function foldCharacters(text: string, matchCase: boolean): string[] {
  return [...text].map((character) =>
    matchCase ? character : ([...character.toLowerCase()][0] ?? character),
  );
}

// Character offsets of every non-overlapping occurrence of `needle` in `haystack`.
function occurrences(
  haystack: readonly string[],
  needle: readonly string[],
): number[] {
  const found: number[] = [];
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
      found.push(start);
      start += needle.length;
    } else {
      start += 1;
    }
  }
  return found;
}

export function findMatches(
  text: string,
  query: string,
  matchCase: boolean,
): TextMatch[] {
  const needle = foldCharacters(query, matchCase);
  const length = needle.length;
  const matches: TextMatch[] = [];
  text.split(LINE_BREAK).forEach((lineText, index) => {
    for (const start of occurrences(
      foldCharacters(lineText, matchCase),
      needle,
    )) {
      matches.push({ line: index + 1, start, length, lineText });
    }
  });
  return matches;
}

export interface Replaced {
  readonly text: string;
  readonly count: number;
}

// Every occurrence replaced by `replacement` (taken literally). Line breaks are untouched
// because a query never spans lines.
export function replaceAll(
  text: string,
  query: string,
  replacement: string,
  matchCase: boolean,
): Replaced {
  const characters = [...text];
  const found = occurrences(
    foldCharacters(text, matchCase),
    foldCharacters(query, matchCase),
  );
  const queryLength = [...query].length;
  const spansLine = (start: number) =>
    characters
      .slice(start, start + queryLength)
      .some((character) => character === "\n" || character === "\r");
  const starts = found.filter((start) => !spansLine(start));
  if (starts.length === 0) return { text, count: 0 };
  let result = "";
  let cursor = 0;
  for (const start of starts) {
    result += characters.slice(cursor, start).join("") + replacement;
    cursor = start + queryLength;
  }
  result += characters.slice(cursor).join("");
  return { text: result, count: starts.length };
}

// Which occurrence: its 1-based line and its 0-based place among the occurrences of that
// line, as `findMatches` lists them. (A position in characters is not used: the Project
// search shows a cut excerpt of a long line, whose offsets are not the line's.)
export interface OccurrenceAt {
  readonly line: number;
  readonly ordinal: number;
}

const LINE_WITH_BREAK = /[^\n]*(?:\n|$)/g;
const TRAILING_BREAK = /\r?\n$/;

// Only the occurrence at `at` replaced. Count 0 when the line no longer has it.
export function replaceOccurrence(
  text: string,
  query: string,
  replacement: string,
  matchCase: boolean,
  at: OccurrenceAt,
): Replaced {
  const lines = text.match(LINE_WITH_BREAK) ?? [text];
  const lineWithBreak = lines[at.line - 1];
  if (lineWithBreak === undefined) return { text, count: 0 };
  const lineText = lineWithBreak.replace(TRAILING_BREAK, "");
  const lineBreak = lineWithBreak.slice(lineText.length);
  const characters = [...lineText];
  const start = occurrences(
    foldCharacters(lineText, matchCase),
    foldCharacters(query, matchCase),
  )[at.ordinal];
  if (start === undefined) return { text, count: 0 };
  const queryLength = [...query].length;
  const replacedLine =
    characters.slice(0, start).join("") +
    replacement +
    characters.slice(start + queryLength).join("") +
    lineBreak;
  const before = lines.slice(0, at.line - 1).join("");
  const after = lines.slice(at.line).join("");
  return { text: before + replacedLine + after, count: 1 };
}

// Where the occurrence at `at` is in the whole text, in UTF-16 code units (what a text
// field's selection uses); null when the line no longer has it.
export function occurrenceRange(
  text: string,
  query: string,
  matchCase: boolean,
  at: OccurrenceAt,
): { readonly start: number; readonly end: number } | null {
  const lines = text.match(LINE_WITH_BREAK) ?? [text];
  const lineWithBreak = lines[at.line - 1];
  if (lineWithBreak === undefined) return null;
  const lineText = lineWithBreak.replace(TRAILING_BREAK, "");
  const characters = [...lineText];
  const start = occurrences(
    foldCharacters(lineText, matchCase),
    foldCharacters(query, matchCase),
  )[at.ordinal];
  if (start === undefined) return null;
  const lineStart = lines.slice(0, at.line - 1).join("").length;
  const before = characters.slice(0, start).join("").length;
  const found = characters.slice(start, start + [...query].length).join("");
  return {
    start: lineStart + before,
    end: lineStart + before + found.length,
  };
}
