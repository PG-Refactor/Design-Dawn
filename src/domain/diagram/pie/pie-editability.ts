import type { LineRef } from "../source-lines";
import type { ParsedPie, PieUnsupportedReason } from "./pie-parser";

// When may the GUI edit a pie chart?
//
// Rule: a chart is editable when every line was classified and nothing in the text makes
// the line-based reading differ from what Mermaid reads. Lines that are recognised but not
// editable (comments, directives, front matter, accTitle / accDescr, the `showData` flag,
// a `title` statement) never block slice operations, because their meaning does not depend
// on any slice line. These do block:
//   - unsupportedLines: a line the parser could not classify (the reason lists them)
//   - duplicateLabels: Mermaid keeps the first slice of a repeated label and drops the
//     rest, so an operation could not say what it changes
//   - loneCarriageReturn / markupRewrite / styleLikeText / inlineDirective: Mermaid
//     rewrites the text before parsing, so the line text is not what it parses

export type PieNotEditableReason =
  | "notPie"
  | "unsupportedLines"
  | "duplicateLabels"
  | "loneCarriageReturn"
  | "markupRewrite"
  | "styleLikeText"
  | "inlineDirective";

export type PieEditability =
  | { readonly editable: true }
  | {
      readonly editable: false;
      readonly reason: PieNotEditableReason;
      readonly detail: string;
      // Lines (as source ranges) behind the reason, when it is about lines.
      readonly lines: readonly LineRef[];
    };

export function findDuplicateLabels(parsed: ParsedPie): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const slice of parsed.slices) {
    if (seen.has(slice.label)) duplicates.add(slice.label);
    seen.add(slice.label);
  }
  return [...duplicates];
}

function refOf(parsed: ParsedPie, lineIndex: number): LineRef {
  const line = parsed.lines[lineIndex];
  return line === undefined
    ? { index: lineIndex, start: 0, end: 0 }
    : { index: line.index, start: line.start, end: line.end };
}

function describeUnsupported(
  entries: readonly { lineIndex: number; reason: PieUnsupportedReason }[],
): string {
  return entries
    .map((entry) => `line ${entry.lineIndex + 1} (${entry.reason})`)
    .join(", ");
}

export function pieEditability(parsed: ParsedPie): PieEditability {
  if (!parsed.isPie) {
    return {
      editable: false,
      reason: "notPie",
      detail: `not a readable pie chart (${parsed.detection.kind})`,
      lines: [],
    };
  }
  if (parsed.unsupported.length > 0) {
    return {
      editable: false,
      reason: "unsupportedLines",
      detail: describeUnsupported(parsed.unsupported),
      lines: parsed.unsupported.map((entry) => refOf(parsed, entry.lineIndex)),
    };
  }
  const [sourceIssue] = parsed.sourceIssues;
  if (sourceIssue !== undefined) {
    return {
      editable: false,
      reason: sourceIssue.code,
      detail:
        sourceIssue.lineIndexes.length === 0
          ? "Mermaid rewrites this text before reading it"
          : `line ${sourceIssue.lineIndexes.map((index) => index + 1).join(", ")}`,
      lines: sourceIssue.lineIndexes.map((index) => refOf(parsed, index)),
    };
  }
  const duplicates = findDuplicateLabels(parsed);
  if (duplicates.length > 0) {
    return {
      editable: false,
      reason: "duplicateLabels",
      detail: `Mermaid keeps only the first slice of a repeated label: ${duplicates
        .map((label) => JSON.stringify(label))
        .join(", ")}`,
      lines: parsed.slices
        .filter((slice) => duplicates.includes(slice.label))
        .map((slice) => refOf(parsed, slice.lineIndex)),
    };
  }
  return { editable: true };
}
