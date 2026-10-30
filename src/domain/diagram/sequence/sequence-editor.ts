import type {
  DiagramEditorAssessment,
  DiagramEditorEntry,
} from "../diagram-source";
import { sequenceEditability } from "./sequence-editability";
import { readSequence } from "./sequence-reader";

// What `analyzeDiagramSource` needs from the sequence editor: editable or not, and when not,
// the reason and the lines the reader could not understand. Same shape as PIE_EDITOR.assess.
export function assessSequence(source: string): DiagramEditorAssessment {
  const editability = sequenceEditability(readSequence(source));
  return editability.editable
    ? { editable: true }
    : {
        editable: false,
        reason: editability.reason,
        detail: editability.detail,
        unsupported:
          editability.reason === "unsupportedStatements"
            ? editability.lines
            : [],
      };
}

export const SEQUENCE_EDITOR: DiagramEditorEntry = {
  type: "sequence",
  assess: assessSequence,
};
