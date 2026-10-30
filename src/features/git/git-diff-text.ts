// Pure helpers of the diff view: how the lines of a unified diff are told apart, and how
// the size limit is written. Nothing here touches the DOM.

export const DIFF_LINE_KINDS = [
  "add",
  "del",
  "hunk",
  "meta",
  "context",
] as const;

export type DiffLineKind = (typeof DIFF_LINE_KINDS)[number];

export interface DiffLine {
  // 1-based position in the diff text; identifies the line within one diff.
  readonly number: number;
  readonly kind: DiffLineKind;
  // The line as git wrote it, prefix included, so the meaning is not colour-only.
  readonly text: string;
}

const HUNK_PREFIX = "@@";
const FILE_HEADER_PREFIX = "diff ";
const NO_NEWLINE_PREFIX = "\\";
const ADDED_PREFIX = "+";
const REMOVED_PREFIX = "-";

// Lines before the first hunk of a file are headers (`---` / `+++` among them); inside a
// hunk every line is content, so a removed line "-- x" (shown as `--- x`) is not mistaken
// for a header. A `diff ` line starts the next file.
export function classifyDiffLines(diff: string): readonly DiffLine[] {
  const lines = diff.split("\n");
  // A diff ends with a line break; the empty piece after it is not a line.
  if (lines.at(-1) === "") lines.pop();
  let inHunk = false;
  return lines.map((text, index): DiffLine => {
    const number = index + 1;
    if (text.startsWith(HUNK_PREFIX)) {
      inHunk = true;
      return { number, kind: "hunk", text };
    }
    if (!inHunk || text.startsWith(FILE_HEADER_PREFIX)) {
      if (text.startsWith(FILE_HEADER_PREFIX)) inHunk = false;
      return { number, kind: "meta", text };
    }
    if (text.startsWith(NO_NEWLINE_PREFIX))
      return { number, kind: "meta", text };
    if (text.startsWith(ADDED_PREFIX)) return { number, kind: "add", text };
    if (text.startsWith(REMOVED_PREFIX)) return { number, kind: "del", text };
    return { number, kind: "context", text };
  });
}

const BYTES_PER_KIB = 1024;
const BYTES_PER_MIB = BYTES_PER_KIB * BYTES_PER_KIB;

function withoutTrailingZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

// The diff size limit for the "too large" text: MiB from 1 MiB on, KiB from 1 KiB, else
// bytes; at most one decimal ("1.5 MiB"), a whole number without one ("1 MiB").
export function formatByteLimit(bytes: number): string {
  if (bytes >= BYTES_PER_MIB) {
    return `${withoutTrailingZero(bytes / BYTES_PER_MIB)} MiB`;
  }
  if (bytes >= BYTES_PER_KIB) {
    return `${withoutTrailingZero(bytes / BYTES_PER_KIB)} KiB`;
  }
  return `${bytes} B`;
}
