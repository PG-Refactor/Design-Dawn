import type {
  DiagramEditorAssessment,
  DiagramEditorEntry,
} from "../diagram-source";
import { ganttEditability } from "./gantt-editability";
import { parseGantt } from "./gantt-parser";

// What `analyzeDiagramSource` needs from the gantt editor: editable or not, and when not,
// the reason and the lines the reader could not understand. Same shape as PIE_EDITOR.assess.
export function assessGantt(source: string): DiagramEditorAssessment {
  const editability = ganttEditability(parseGantt(source));
  return editability.editable
    ? { editable: true }
    : {
        editable: false,
        reason: editability.reason,
        detail: editability.detail,
        unsupported:
          editability.reason === "unsupportedLines" ? editability.lines : [],
      };
}

export const GANTT_EDITOR: DiagramEditorEntry = {
  type: "gantt",
  assess: assessGantt,
};
