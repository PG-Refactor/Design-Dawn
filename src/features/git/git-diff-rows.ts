// Pure model of the diff body: the unified diff is cut into hunks and laid out as rows for
// the inline view and the side-by-side view. Only the hunks
// are used (changed lines +- context); the full file contents are never fetched. Nothing
// here touches the DOM and nothing throws: a header that cannot be read just loses its
// line numbers.

import { classifyDiffLines } from "./git-diff-text";

export type DiffContentKind = "context" | "added" | "removed";

export type InlineRowKind = DiffContentKind | "hunk" | "note";

export interface InlineRow {
  // Position in the row list; stable for one diff text.
  readonly key: number;
  readonly kind: InlineRowKind;
  readonly oldNumber: number | null;
  readonly newNumber: number | null;
  // The line without its `+` / `-` / space marker. For a hunk: the text after the header's
  // closing `@@` (git's function context), possibly empty. For a note: the whole line.
  readonly text: string;
}

export interface SplitCell {
  readonly kind: DiffContentKind;
  readonly number: number | null;
  readonly text: string;
  // A `\ No newline at end of file` line that follows this line, shown inside the cell so
  // that it stays on the side it refers to and keeps the pairing of rows intact.
  readonly note: string | null;
}

export type SplitRow =
  | {
      readonly key: number;
      readonly kind: "line";
      readonly left: SplitCell | null;
      readonly right: SplitCell | null;
    }
  // Full-width rows: the hunk separator and a note that follows no line.
  | {
      readonly key: number;
      readonly kind: "hunk" | "note";
      readonly text: string;
    };

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;
const MARKER_LENGTH = 1;

interface HunkLine {
  readonly kind: DiffContentKind;
  readonly text: string;
  note: string | null;
}

type HunkItem = HunkLine | { readonly kind: "note"; readonly text: string };

interface Hunk {
  readonly context: string;
  // null when the header could not be read: the lines are then shown without numbers.
  readonly oldStart: number | null;
  readonly newStart: number | null;
  readonly items: HunkItem[];
}

interface ParsedDiff {
  readonly hunks: readonly Hunk[];
  readonly metaLines: readonly string[];
}

function parseHeader(text: string): Hunk {
  const match = HUNK_HEADER.exec(text);
  if (match === null) {
    return { context: "", oldStart: null, newStart: null, items: [] };
  }
  return {
    context: match[3] ?? "",
    oldStart: Number(match[1]),
    newStart: Number(match[2]),
    items: [],
  };
}

function parseDiff(diff: string): ParsedDiff {
  const hunks: Hunk[] = [];
  const metaLines: string[] = [];
  let current: Hunk | null = null;
  for (const line of classifyDiffLines(diff)) {
    if (line.kind === "hunk") {
      current = parseHeader(line.text);
      hunks.push(current);
    } else if (line.kind === "meta") {
      const last = current?.items.at(-1);
      if (current !== null && line.text.startsWith("\\")) {
        if (last !== undefined && last.kind !== "note" && last.note === null) {
          last.note = line.text;
        } else {
          current.items.push({ kind: "note", text: line.text });
        }
      } else {
        // A file header (or the next file's `diff ` line) ends the hunk.
        current = null;
        metaLines.push(line.text);
      }
    } else if (current !== null) {
      const kind =
        line.kind === "add"
          ? "added"
          : line.kind === "del"
            ? "removed"
            : "context";
      current.items.push({
        kind,
        text: line.text.slice(MARKER_LENGTH),
        note: null,
      });
    }
  }
  return { hunks, metaLines };
}

// Line numbers of one hunk; stay null when the header was unreadable.
class LineCounter {
  private oldNext: number | null;
  private newNext: number | null;

  constructor(hunk: Hunk) {
    this.oldNext = hunk.oldStart;
    this.newNext = hunk.newStart;
  }

  takeOld(): number | null {
    const value = this.oldNext;
    if (this.oldNext !== null) this.oldNext += 1;
    return value;
  }

  takeNew(): number | null {
    const value = this.newNext;
    if (this.newNext !== null) this.newNext += 1;
    return value;
  }
}

// A diff without any hunk (a mode change, an empty-file rename) still has something to
// tell: its header lines are shown as notes instead of an empty body.
function metaOnlyRows<Row>(
  parsed: ParsedDiff,
  makeRow: (key: number, text: string) => Row,
): Row[] {
  return parsed.metaLines.map((text, key) => makeRow(key, text));
}

// File headers before a hunk are not shown (the view header already shows it).
export function buildInlineRows(diff: string): readonly InlineRow[] {
  const parsed = parseDiff(diff);
  if (parsed.hunks.length === 0) {
    return metaOnlyRows(parsed, (key, text) => ({
      key,
      kind: "note",
      oldNumber: null,
      newNumber: null,
      text,
    }));
  }
  const rows: InlineRow[] = [];
  const push = (row: Omit<InlineRow, "key">): void => {
    rows.push({ key: rows.length, ...row });
  };
  for (const hunk of parsed.hunks) {
    push({
      kind: "hunk",
      oldNumber: null,
      newNumber: null,
      text: hunk.context,
    });
    const counter = new LineCounter(hunk);
    for (const item of hunk.items) {
      if (item.kind === "note") {
        push({
          kind: "note",
          oldNumber: null,
          newNumber: null,
          text: item.text,
        });
        continue;
      }
      push({
        kind: item.kind,
        oldNumber: item.kind === "added" ? null : counter.takeOld(),
        newNumber: item.kind === "removed" ? null : counter.takeNew(),
        text: item.text,
      });
      if (item.note !== null) {
        push({
          kind: "note",
          oldNumber: null,
          newNumber: null,
          text: item.note,
        });
      }
    }
  }
  return rows;
}

export function buildSplitRows(diff: string): readonly SplitRow[] {
  const parsed = parseDiff(diff);
  if (parsed.hunks.length === 0) {
    return metaOnlyRows(
      parsed,
      (key, text): SplitRow => ({
        key,
        kind: "note",
        text,
      }),
    );
  }
  const rows: SplitRow[] = [];
  for (const hunk of parsed.hunks) {
    rows.push({ key: rows.length, kind: "hunk", text: hunk.context });
    const counter = new LineCounter(hunk);
    let removed: SplitCell[] = [];
    let added: SplitCell[] = [];
    // A run of removed lines followed by a run of added lines is a modification: the two
    // runs are paired row by row; the longer one's leftovers face an empty cell.
    const flush = (): void => {
      const count = Math.max(removed.length, added.length);
      for (let index = 0; index < count; index += 1) {
        rows.push({
          key: rows.length,
          kind: "line",
          left: removed[index] ?? null,
          right: added[index] ?? null,
        });
      }
      removed = [];
      added = [];
    };
    for (const item of hunk.items) {
      if (item.kind === "note") {
        flush();
        rows.push({ key: rows.length, kind: "note", text: item.text });
      } else if (item.kind === "removed") {
        // A removal after additions starts a new change.
        if (added.length > 0) flush();
        removed.push({
          kind: "removed",
          number: counter.takeOld(),
          text: item.text,
          note: item.note,
        });
      } else if (item.kind === "added") {
        added.push({
          kind: "added",
          number: counter.takeNew(),
          text: item.text,
          note: item.note,
        });
      } else {
        flush();
        rows.push({
          key: rows.length,
          kind: "line",
          left: {
            kind: "context",
            number: counter.takeOld(),
            text: item.text,
            note: item.note,
          },
          right: {
            kind: "context",
            number: counter.takeNew(),
            text: item.text,
            note: item.note,
          },
        });
      }
    }
    flush();
  }
  return rows;
}
