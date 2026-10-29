import type {
  FlowchartOpaqueReason,
  FlowchartToken,
  TextSpan,
} from "./flowchart-types";

// Shared plumbing of the statement parsers. A `Scan` is the text of ONE statement (blanks at
// both ends already removed) together with the offset of its first character in the source,
// so every token can be given an absolute span while the parsers work on short local
// strings. Parsers never throw: a failure is a value carrying the opaque reason.

export interface Scan {
  readonly text: string;
  // Offset of text[0] in the source.
  readonly base: number;
}

export type ParseOutcome<Value> =
  | { readonly ok: true; readonly value: Value; readonly end: number }
  | { readonly ok: false; readonly reason: FlowchartOpaqueReason };

export function parsed<Value>(value: Value, end: number): ParseOutcome<Value> {
  return { ok: true, value, end };
}

export function failed<Value = never>(
  reason: FlowchartOpaqueReason,
): ParseOutcome<Value> {
  return { ok: false, reason };
}

export function spanOf(scan: Scan, start: number, end: number): TextSpan {
  return { start: scan.base + start, end: scan.base + end };
}

export function tokenOf(
  scan: Scan,
  start: number,
  end: number,
): FlowchartToken {
  return { text: scan.text.slice(start, end), span: spanOf(scan, start, end) };
}

export function isBlankCharacter(character: string | undefined): boolean {
  return character === " " || character === "\t";
}

export function skipBlanks(text: string, from: number): number {
  let position = from;
  while (isBlankCharacter(text[position])) position += 1;
  return position;
}
