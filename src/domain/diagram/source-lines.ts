// Lossless line scan and classification of Mermaid source. Positions are UTF-16 code unit
// offsets into the original string (see text-edit.ts), so nothing here trims or rewrites.

export const LINE_TERMINATORS = ["", "\n", "\r\n"] as const;
export type LineTerminator = (typeof LINE_TERMINATORS)[number];

const LINE_FEED = "\n";
const CARRIAGE_RETURN = "\r";
const CRLF_TERMINATOR: LineTerminator = "\r\n";
const FRONT_MATTER_FENCE_PATTERN = /^---\s*$/;
const COMMENT_PREFIX = "%%";
const DIRECTIVE_PREFIX = "%%{";
const DIRECTIVE_SUFFIX = "}%%";

export interface SourceLine {
  readonly index: number;
  // Offset of the first character of the line.
  readonly start: number;
  // Offset just after the last character of the text, before the terminator.
  readonly end: number;
  readonly terminator: LineTerminator;
  // Never contains "\n". A lone "\r" (not followed by "\n") is ordinary text of the line:
  // Mermaid and the app treat only "\n" and "\r\n" as line breaks.
  readonly text: string;
}

// Splits the source at "\n" / "\r\n" without losing a character: joining `text` +
// `terminator` of every line gives the source back. A trailing terminator does not create
// an extra empty line, and the empty source has no lines.
export function scanLines(source: string): readonly SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  while (start < source.length) {
    const lineFeedAt = source.indexOf(LINE_FEED, start);
    if (lineFeedAt === -1) {
      lines.push({
        index: lines.length,
        start,
        end: source.length,
        terminator: "",
        text: source.slice(start),
      });
      break;
    }
    const hasCarriageReturn =
      lineFeedAt > start && source[lineFeedAt - 1] === CARRIAGE_RETURN;
    const end = hasCarriageReturn ? lineFeedAt - 1 : lineFeedAt;
    lines.push({
      index: lines.length,
      start,
      end,
      terminator: hasCarriageReturn ? CRLF_TERMINATOR : LINE_FEED,
      text: source.slice(start, end),
    });
    start = lineFeedAt + 1;
  }
  return lines;
}

export type LineKind =
  | "blank"
  | "comment"
  | "directive"
  | "frontMatter"
  | "header"
  | "statement";

export interface ClassifiedLine extends SourceLine {
  readonly kind: LineKind;
}

export interface LineRef {
  readonly index: number;
  readonly start: number;
  readonly end: number;
}

// Structures that cannot be read reliably. Detection reports them instead of guessing.
export type LineIssue =
  | "unterminatedFrontMatter"
  | "multilineDirective"
  | "unterminatedDirective";

export interface LineClassification {
  readonly lines: readonly ClassifiedLine[];
  readonly issues: readonly LineIssue[];
}

function isBlank(text: string): boolean {
  return text.trim() === "";
}

// Front matter exists only when the very first line is the fence (Mermaid anchors it at
// the start of the text). Returns the index of the closing fence, or null if unterminated.
function findFrontMatterEnd(lines: readonly SourceLine[]): number | null {
  for (let index = 1; index < lines.length; index += 1) {
    if (FRONT_MATTER_FENCE_PATTERN.test(lines[index]?.text ?? "")) return index;
  }
  return null;
}

export function classifyLines(
  lines: readonly SourceLine[],
): LineClassification {
  const classified: ClassifiedLine[] = [];
  const issues: LineIssue[] = [];
  let index = 0;

  if (FRONT_MATTER_FENCE_PATTERN.test(lines[0]?.text ?? "")) {
    const closingIndex = findFrontMatterEnd(lines);
    if (closingIndex === null) issues.push("unterminatedFrontMatter");
    // An unterminated block swallows the rest: nothing after it can be trusted.
    const lastFrontMatterIndex = closingIndex ?? lines.length - 1;
    for (; index <= lastFrontMatterIndex; index += 1) {
      classified.push({ ...(lines[index] as SourceLine), kind: "frontMatter" });
    }
  }

  let headerSeen = false;
  while (index < lines.length) {
    const line = lines[index] as SourceLine;
    const trimmed = line.text.trim();
    if (isBlank(line.text)) {
      classified.push({ ...line, kind: "blank" });
      index += 1;
    } else if (trimmed.startsWith(DIRECTIVE_PREFIX)) {
      const closingIndex = findDirectiveEnd(lines, index);
      if (closingIndex === null) {
        issues.push("unterminatedDirective");
      } else if (closingIndex !== index) {
        issues.push("multilineDirective");
      }
      const last = closingIndex ?? lines.length - 1;
      for (; index <= last; index += 1) {
        classified.push({ ...(lines[index] as SourceLine), kind: "directive" });
      }
    } else if (trimmed.startsWith(COMMENT_PREFIX)) {
      classified.push({ ...line, kind: "comment" });
      index += 1;
    } else {
      classified.push({ ...line, kind: headerSeen ? "statement" : "header" });
      headerSeen = true;
      index += 1;
    }
  }
  return { lines: classified, issues };
}

function findDirectiveEnd(
  lines: readonly SourceLine[],
  startIndex: number,
): number | null {
  for (let index = startIndex; index < lines.length; index += 1) {
    if ((lines[index]?.text ?? "").trimEnd().endsWith(DIRECTIVE_SUFFIX)) {
      return index;
    }
  }
  return null;
}
