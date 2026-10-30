import type { LineRef } from "../source-lines";
import { SEQUENCE_MAX_SOURCE_LENGTH } from "./sequence-config";
import type { SequenceReading } from "./sequence-reader";

// When may the GUI edit a sequence diagram?
//
// Rule: every statement was understood, Mermaid's pre-parse rewriting cannot have changed
// what a line means, Mermaid accepts the statements together, and no participant is declared
// again after it already existed (that breaks the column chain Mermaid lays out by). Things
// the reader recognises but the operations do not touch (`activate` / `deactivate`, the
// `rect` colour, an `autonumber` with arguments, comments, directives, front matter) never
// block here.

export type SequenceNotEditableReason =
  | "notSequence"
  | "sourceTooLong"
  | "structureIssue"
  | "loneCarriageReturn"
  | "markupRewrite"
  | "styleLikeText"
  | "inlineDirective"
  | "unsupportedStatements"
  | "invalidDiagram"
  | "participantRedeclared";

export type SequenceEditability =
  | { readonly editable: true }
  | {
      readonly editable: false;
      readonly reason: SequenceNotEditableReason;
      readonly detail: string;
      // Lines (as source ranges) behind the reason, when it is about lines.
      readonly lines: readonly LineRef[];
    };

function refOf(reading: SequenceReading, lineIndex: number): LineRef {
  const line = reading.lines[lineIndex];
  return line === undefined
    ? { index: lineIndex, start: 0, end: 0 }
    : { index: line.index, start: line.start, end: line.end };
}

function uniqueLineRefs(
  reading: SequenceReading,
  lineIndexes: readonly number[],
): readonly LineRef[] {
  return [...new Set(lineIndexes)]
    .sort((left, right) => left - right)
    .map((index) => refOf(reading, index));
}

export function sequenceEditability(
  reading: SequenceReading,
): SequenceEditability {
  if (!reading.isSequence) {
    return {
      editable: false,
      reason: "notSequence",
      detail: `not a readable sequence diagram (${reading.detection.kind})`,
      lines: [],
    };
  }
  if (reading.source.length > SEQUENCE_MAX_SOURCE_LENGTH) {
    return {
      editable: false,
      reason: "sourceTooLong",
      detail: `${reading.source.length} characters; Mermaid draws at most ${SEQUENCE_MAX_SOURCE_LENGTH}`,
      lines: [],
    };
  }
  const [structureIssue] = reading.structureIssues;
  if (structureIssue !== undefined) {
    return {
      editable: false,
      reason: "structureIssue",
      detail: structureIssue,
      lines: [],
    };
  }
  const [sourceIssue] = reading.sourceIssues;
  if (sourceIssue !== undefined) {
    return {
      editable: false,
      reason: sourceIssue.code,
      detail:
        sourceIssue.lineIndexes.length === 0
          ? "Mermaid rewrites this text before reading it"
          : `line ${sourceIssue.lineIndexes.map((index) => index + 1).join(", ")}`,
      lines: uniqueLineRefs(reading, sourceIssue.lineIndexes),
    };
  }
  if (reading.opaque.length > 0) {
    return {
      editable: false,
      reason: "unsupportedStatements",
      detail: reading.opaque
        .map((entry) => `line ${entry.lineIndex + 1} (${entry.reason})`)
        .join(", "),
      lines: uniqueLineRefs(
        reading,
        reading.opaque.map((entry) => entry.lineIndex),
      ),
    };
  }
  if (reading.invalid !== null) {
    return {
      editable: false,
      reason: "invalidDiagram",
      detail: `${reading.invalid.reason}: ${reading.invalid.detail}`,
      lines: [],
    };
  }
  const meaning = reading.meaning;
  if (meaning === null) {
    // Cannot happen once the checks above passed; refuse instead of guessing.
    return {
      editable: false,
      reason: "unsupportedStatements",
      detail: "the meaning of the text could not be established",
      lines: [],
    };
  }
  if (
    meaning.redeclaredParticipants.length > 0 ||
    !meaning.layoutChainConsistent
  ) {
    return {
      editable: false,
      reason: "participantRedeclared",
      detail: `declared after it already existed: ${meaning.redeclaredParticipants.join(", ")}`,
      lines: [],
    };
  }
  return { editable: true };
}
