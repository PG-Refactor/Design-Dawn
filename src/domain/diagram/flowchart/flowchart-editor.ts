import type {
  DiagramEditorAssessment,
  DiagramEditorEntry,
} from "../diagram-source";
import { flowchartEditability } from "./flowchart-editability";
import { readFlowchart } from "./flowchart-reader";

// What `analyzeDiagramSource` needs from the flowchart editor: editable or not, and when
// not, the reason and the lines the reader could not understand. Same shape as
// PIE_EDITOR.assess. NOT registered in DIAGRAM_EDITORS yet: registration, together with the
// operations, the gate and the GUI, is Step 9-8 (docs/architecture.md §16.15.10).
export function assessFlowchart(source: string): DiagramEditorAssessment {
  const editability = flowchartEditability(readFlowchart(source));
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

export const FLOWCHART_EDITOR: DiagramEditorEntry = {
  type: "flowchart",
  assess: assessFlowchart,
};
