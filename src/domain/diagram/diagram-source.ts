import type { DiagramType } from "./diagram-type";
import { type DiagramTypeDetection, detectDiagramType } from "./diagram-type";
import { FLOWCHART_EDITOR } from "./flowchart/flowchart-editor";
import { PIE_EDITOR } from "./pie/pie-editor";
import { SEQUENCE_EDITOR } from "./sequence/sequence-editor";
import {
  type ClassifiedLine,
  classifyLines,
  type LineRef,
  scanLines,
} from "./source-lines";

// What the common layer needs from a type's editor: whether this source may be edited,
// and if not, why and which lines the editor could not understand. The first (and so far
// only) editor, pie, decided the shape.
export type DiagramEditorAssessment =
  | { readonly editable: true }
  | {
      readonly editable: false;
      // A short code of the editor's own (for pie: PieNotEditableReason) and a message.
      readonly reason: string;
      readonly detail: string;
      readonly unsupported: readonly LineRef[];
    };

export interface DiagramEditorEntry {
  readonly type: DiagramType;
  readonly assess: (source: string) => DiagramEditorAssessment;
}

// Later steps add one entry per type here. A type without an entry is never editable.
export const DIAGRAM_EDITORS: Partial<Record<DiagramType, DiagramEditorEntry>> =
  {
    pie: PIE_EDITOR,
    flowchart: FLOWCHART_EDITOR,
    sequence: SEQUENCE_EDITOR,
  };

export type NotEditableReason =
  | "empty"
  | "unknownType"
  | "invalidFrontMatter"
  | "noEditorForType"
  // The type has an editor and it refused this source; `detail` holds its reason.
  | "editorRefused";

export type DiagramEditability =
  | { readonly editable: true; readonly type: DiagramType }
  | {
      readonly editable: false;
      readonly reason: NotEditableReason;
      readonly detail?: string;
    };

export interface DiagramSourceAnalysis {
  readonly source: string;
  readonly detection: DiagramTypeDetection;
  readonly lines: readonly ClassifiedLine[];
  // Statement lines no type parser has claimed. For a type without an editor that is every
  // statement line, so nothing is ever reported as understood by accident; for a type with
  // one, the lines its editor could not understand.
  readonly unsupported: readonly LineRef[];
  readonly editability: DiagramEditability;
}

function decideEditability(
  detection: DiagramTypeDetection,
  assessment: DiagramEditorAssessment | undefined,
): DiagramEditability {
  switch (detection.kind) {
    case "empty":
      return { editable: false, reason: "empty" };
    case "unknown":
      return {
        editable: false,
        reason:
          detection.reason === "unterminatedFrontMatter"
            ? "invalidFrontMatter"
            : "unknownType",
      };
    case "known":
      if (assessment === undefined) {
        return { editable: false, reason: "noEditorForType" };
      }
      return assessment.editable
        ? { editable: true, type: detection.type }
        : {
            editable: false,
            reason: "editorRefused",
            detail: `${assessment.reason}: ${assessment.detail}`,
          };
  }
}

export function analyzeDiagramSource(source: string): DiagramSourceAnalysis {
  const detection = detectDiagramType(source);
  const { lines } = classifyLines(scanLines(source));
  const entry =
    detection.kind === "known" ? DIAGRAM_EDITORS[detection.type] : undefined;
  const assessment = entry?.assess(source);
  const unsupported =
    assessment === undefined
      ? lines
          .filter((line) => line.kind === "statement")
          .map(({ index, start, end }) => ({ index, start, end }))
      : assessment.editable
        ? []
        : assessment.unsupported;
  return {
    source,
    detection,
    lines,
    unsupported,
    editability: decideEditability(detection, assessment),
  };
}
