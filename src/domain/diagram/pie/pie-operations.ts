import { type DomainResult, err, ok } from "../../shared/domain-result";
import type { TextEdit } from "../text-edit";
import {
  PIE_DEFAULT_INDENT,
  PIE_DEFAULT_LINE_ENDING,
  PIE_LABEL_QUOTE,
  PIE_VALUE_SEPARATOR,
} from "./pie-config";
import { pieEditability } from "./pie-editability";
import { checkPieMeaning, type PieMeaning, pieMeaningOf } from "./pie-meaning";
import {
  type ParsedPie,
  type PieLine,
  type PieSlice,
  parsePie,
} from "./pie-parser";
import {
  encodePieLabel,
  validatePieTitle,
  validatePieValueText,
} from "./pie-text";

// Pie operations: pure functions from the current source to a minimal set of TextEdits plus
// the meaning the result must have. They touch only the label content or the value of one
// slice, or insert / delete whole lines, so every byte outside the edits stays as it was.
// The caller applies the edits, then proves the candidate with `verifyPieCandidate`.

export interface PieSliceTarget {
  // Position in source order, plus the label the caller believes it has. Both must agree,
  // so a stale index cannot silently change another slice.
  readonly index: number;
  readonly label: string;
}

export type PieOperation =
  | {
      readonly kind: "addSlice";
      readonly label: string;
      readonly valueText: string;
      // Position among the slices (0..count); the end when omitted.
      readonly index?: number;
    }
  | {
      readonly kind: "renameSlice";
      readonly target: PieSliceTarget;
      readonly label: string;
    }
  | {
      readonly kind: "setSliceValue";
      readonly target: PieSliceTarget;
      readonly valueText: string;
    }
  | { readonly kind: "deleteSlice"; readonly target: PieSliceTarget }
  | {
      readonly kind: "moveSlice";
      readonly target: PieSliceTarget;
      // The slice's index after the move.
      readonly toIndex: number;
    }
  | { readonly kind: "setTitle"; readonly title: string }
  | { readonly kind: "removeTitle" };

export interface PieOperationPlan {
  readonly edits: readonly TextEdit[];
  readonly expected: PieMeaning;
}

interface PreparedPie {
  readonly parsed: ParsedPie;
  readonly meaning: PieMeaning;
}

function refuse<T>(reason: string, detail: string): DomainResult<T> {
  return err("invalidDiagramOperation", `${reason}: ${detail}`);
}

function prepare(source: string): DomainResult<PreparedPie> {
  const parsed = parsePie(source);
  const editability = pieEditability(parsed);
  if (!editability.editable) {
    return err(
      "diagramNotEditable",
      `${editability.reason}: ${editability.detail}`,
    );
  }
  return ok({ parsed, meaning: pieMeaningOf(parsed) });
}

function resolveTarget(
  parsed: ParsedPie,
  target: PieSliceTarget,
): DomainResult<PieSlice> {
  const slice = Number.isInteger(target.index)
    ? parsed.slices[target.index]
    : undefined;
  if (slice === undefined) {
    return refuse("targetNotFound", `no slice at index ${target.index}`);
  }
  if (slice.label !== target.label) {
    return refuse(
      "targetMismatch",
      `slice ${target.index} is ${JSON.stringify(slice.label)}, not ${JSON.stringify(target.label)}`,
    );
  }
  return ok(slice);
}

function lineAt(parsed: ParsedPie, index: number): PieLine {
  return parsed.lines[index] as PieLine;
}

// The line ending of a line, or of the closest line that has one, so an inserted line
// matches its neighbours (CRLF next to CRLF) and a file that ends without a newline still
// gets a sensible ending.
function lineEndingNear(parsed: ParsedPie, lineIndex: number): string {
  for (let distance = 0; distance < parsed.lines.length; distance += 1) {
    for (const candidate of [lineIndex - distance, lineIndex + distance]) {
      const terminator = parsed.lines[candidate]?.terminator;
      if (terminator !== undefined && terminator !== "") return terminator;
    }
  }
  return PIE_DEFAULT_LINE_ENDING;
}

function insertLineBefore(
  parsed: ParsedPie,
  lineIndex: number,
  content: string,
): TextEdit {
  const line = lineAt(parsed, lineIndex);
  return {
    start: line.start,
    end: line.start,
    text: content + lineEndingNear(parsed, lineIndex),
  };
}

// After the line. A last line without a terminator gets one in front of the new line and
// the new line has none, so "no newline at the end of the file" is preserved.
function insertLineAfter(
  parsed: ParsedPie,
  lineIndex: number,
  content: string,
): TextEdit {
  const line = lineAt(parsed, lineIndex);
  if (line.terminator === "") {
    return {
      start: line.end,
      end: line.end,
      text: lineEndingNear(parsed, lineIndex) + content,
    };
  }
  const at = line.end + line.terminator.length;
  return { start: at, end: at, text: content + line.terminator };
}

// Removes the whole line with its terminator. The last line has none, so the terminator of
// the line before goes instead; otherwise a dangling line ending would be left behind.
function deleteLine(parsed: ParsedPie, lineIndex: number): TextEdit {
  const line = lineAt(parsed, lineIndex);
  if (line.terminator !== "") {
    return {
      start: line.start,
      end: line.end + line.terminator.length,
      text: "",
    };
  }
  const previous = parsed.lines[lineIndex - 1];
  return {
    start: previous === undefined ? line.start : previous.end,
    end: line.end,
    text: "",
  };
}

function indentBefore(parsed: ParsedPie, slice: PieSlice | undefined): string {
  if (slice === undefined) return PIE_DEFAULT_INDENT;
  const line = lineAt(parsed, slice.lineIndex);
  return line.text.slice(0, slice.labelSpan.start - 1 - line.start);
}

function sliceStatement(
  indent: string,
  encodedLabel: string,
  valueText: string,
): string {
  return `${indent}${PIE_LABEL_QUOTE}${encodedLabel}${PIE_LABEL_QUOTE}${PIE_VALUE_SEPARATOR}${valueText}`;
}

function lastLineIndex(parsed: ParsedPie): number {
  return parsed.lines.length - 1;
}

function withSlices(
  meaning: PieMeaning,
  slices: PieMeaning["slices"],
): PieMeaning {
  return { ...meaning, slices };
}

export function addSlice(
  source: string,
  input: { label: string; valueText: string; index?: number },
): DomainResult<PieOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed, meaning } = prepared.value;
  const count = parsed.slices.length;
  const index = input.index ?? count;
  if (!Number.isInteger(index) || index < 0 || index > count) {
    return refuse("invalidIndex", `position ${index} is outside 0-${count}`);
  }
  const label = encodePieLabel(input.label);
  if (!label.ok) return label;
  const value = validatePieValueText(input.valueText);
  if (!value.ok) return value;
  if (parsed.slices.some((slice) => slice.label === label.value)) {
    return refuse(
      "duplicateLabel",
      `a slice labelled ${JSON.stringify(label.value)} exists; Mermaid would drop the new one`,
    );
  }
  const neighbour = parsed.slices[index] ?? parsed.slices[index - 1];
  const statement = sliceStatement(
    indentBefore(parsed, neighbour),
    label.value,
    input.valueText,
  );
  // With no slice to anchor on, the end of the file is the one place that can never be
  // inside a multi-line accDescr block.
  const edit =
    index < count
      ? insertLineBefore(
          parsed,
          (parsed.slices[index] as PieSlice).lineIndex,
          statement,
        )
      : insertLineAfter(
          parsed,
          count > 0
            ? (parsed.slices[count - 1] as PieSlice).lineIndex
            : lastLineIndex(parsed),
          statement,
        );
  const slices = [...meaning.slices];
  slices.splice(index, 0, { label: label.value, value: value.value });
  return ok({ edits: [edit], expected: withSlices(meaning, slices) });
}

export function renameSlice(
  source: string,
  target: PieSliceTarget,
  newLabel: string,
): DomainResult<PieOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed, meaning } = prepared.value;
  const slice = resolveTarget(parsed, target);
  if (!slice.ok) return slice;
  if (slice.value.quote !== PIE_LABEL_QUOTE) {
    return refuse(
      "singleQuotedLabel",
      "a single-quoted label is read but not rewritten",
    );
  }
  const label = encodePieLabel(newLabel);
  if (!label.ok) return label;
  if (
    parsed.slices.some(
      (other, otherIndex) =>
        otherIndex !== target.index && other.label === label.value,
    )
  ) {
    return refuse(
      "duplicateLabel",
      `a slice labelled ${JSON.stringify(label.value)} exists; Mermaid would merge them`,
    );
  }
  const slices = [...meaning.slices];
  slices[target.index] = {
    label: label.value,
    value: (slices[target.index] as PieMeaning["slices"][number]).value,
  };
  const edits =
    label.value === slice.value.label
      ? []
      : [{ ...slice.value.labelSpan, text: label.value }];
  return ok({ edits, expected: withSlices(meaning, slices) });
}

export function setSliceValue(
  source: string,
  target: PieSliceTarget,
  valueText: string,
): DomainResult<PieOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed, meaning } = prepared.value;
  const slice = resolveTarget(parsed, target);
  if (!slice.ok) return slice;
  const value = validatePieValueText(valueText);
  if (!value.ok) return value;
  const slices = [...meaning.slices];
  slices[target.index] = {
    label: (slices[target.index] as PieMeaning["slices"][number]).label,
    value: value.value,
  };
  const edits =
    valueText === slice.value.valueText
      ? []
      : [{ ...slice.value.valueSpan, text: valueText }];
  return ok({ edits, expected: withSlices(meaning, slices) });
}

export function deleteSlice(
  source: string,
  target: PieSliceTarget,
): DomainResult<PieOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed, meaning } = prepared.value;
  const slice = resolveTarget(parsed, target);
  if (!slice.ok) return slice;
  const slices = meaning.slices.filter((_, index) => index !== target.index);
  return ok({
    edits: [deleteLine(parsed, slice.value.lineIndex)],
    expected: withSlices(meaning, slices),
  });
}

export function moveSlice(
  source: string,
  target: PieSliceTarget,
  toIndex: number,
): DomainResult<PieOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed, meaning } = prepared.value;
  const slice = resolveTarget(parsed, target);
  if (!slice.ok) return slice;
  const count = parsed.slices.length;
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= count) {
    return refuse(
      "invalidIndex",
      `position ${toIndex} is outside 0-${count - 1}`,
    );
  }
  const slices = [...meaning.slices];
  const [moved] = slices.splice(target.index, 1);
  slices.splice(toIndex, 0, moved as PieMeaning["slices"][number]);
  if (toIndex === target.index) {
    return ok({ edits: [], expected: withSlices(meaning, slices) });
  }
  const line = lineAt(parsed, slice.value.lineIndex);
  // The whole line moves as it is: indentation and a trailing comment travel with it.
  const content = line.text;
  const anchor = parsed.slices[toIndex] as PieSlice;
  const insertion =
    toIndex < target.index
      ? insertLineBefore(parsed, anchor.lineIndex, content)
      : insertLineAfter(parsed, anchor.lineIndex, content);
  return ok({
    edits: [deleteLine(parsed, slice.value.lineIndex), insertion],
    expected: withSlices(meaning, slices),
  });
}

export function setTitle(
  source: string,
  title: string,
): DomainResult<PieOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed, meaning } = prepared.value;
  if (parsed.titles.length > 1) {
    return refuse(
      "multipleTitles",
      "the chart has more than one title statement",
    );
  }
  const checked = validatePieTitle(title);
  if (!checked.ok) return checked;
  const expected = { ...meaning, title };
  const existing = parsed.titles[0];
  if (existing !== undefined) {
    if (existing.text === title) return ok({ edits: [], expected });
    const edit: TextEdit =
      existing.textSpan.start === existing.textSpan.end
        ? {
            start: existing.keywordSpan.end,
            end: existing.keywordSpan.end,
            text: ` ${title}`,
          }
        : { ...existing.textSpan, text: title };
    return ok({ edits: [edit], expected });
  }
  const statement = `${indentBefore(parsed, parsed.slices[0])}title ${title}`;
  // Before the first slice, or at the end of the file when there is none: neither can be
  // inside a multi-line accDescr block.
  const edit = parsed.slices[0]
    ? insertLineBefore(parsed, parsed.slices[0].lineIndex, statement)
    : insertLineAfter(parsed, lastLineIndex(parsed), statement);
  return ok({ edits: [edit], expected });
}

export function removeTitle(source: string): DomainResult<PieOperationPlan> {
  const prepared = prepare(source);
  if (!prepared.ok) return prepared;
  const { parsed, meaning } = prepared.value;
  if (parsed.titles.length > 1) {
    return refuse(
      "multipleTitles",
      "the chart has more than one title statement",
    );
  }
  const existing = parsed.titles[0];
  if (existing === undefined)
    return refuse("noTitle", "the chart has no title statement");
  const expected = { ...meaning, title: "" };
  if (!existing.onHeaderLine) {
    return ok({ edits: [deleteLine(parsed, existing.lineIndex)], expected });
  }
  // `pie showData title X`: remove the blank before `title` through the end of the text.
  const header = parsed.header;
  const start =
    header?.showDataSpan?.end ??
    header?.keywordSpan.end ??
    existing.keywordSpan.start;
  const end =
    existing.textSpan.end > existing.textSpan.start
      ? existing.textSpan.end
      : existing.keywordSpan.end;
  return ok({ edits: [{ start, end, text: "" }], expected });
}

export function planPieOperation(
  source: string,
  operation: PieOperation,
): DomainResult<PieOperationPlan> {
  switch (operation.kind) {
    case "addSlice":
      return addSlice(source, operation);
    case "renameSlice":
      return renameSlice(source, operation.target, operation.label);
    case "setSliceValue":
      return setSliceValue(source, operation.target, operation.valueText);
    case "deleteSlice":
      return deleteSlice(source, operation.target);
    case "moveSlice":
      return moveSlice(source, operation.target, operation.toIndex);
    case "setTitle":
      return setTitle(source, operation.title);
    case "removeTitle":
      return removeTitle(source);
  }
}

// Proves a candidate: it must read as an editable pie chart whose meaning is exactly what
// the operation promised.
export function verifyPieCandidate(
  candidateSource: string,
  expected: PieMeaning,
): DomainResult<void> {
  return checkPieMeaning(parsePie(candidateSource), expected);
}
