import type { DiagramEditorEntry } from "../diagram-source";
import { pieEditability } from "./pie-editability";
import { parsePie } from "./pie-parser";

// The pie entry of DIAGRAM_EDITORS. `analyzeDiagramSource` reports the chart as editable
// exactly when `pieEditability` says so, and otherwise with the specific reason.
export const PIE_EDITOR: DiagramEditorEntry = {
  type: "pie",
  assess(source) {
    const editability = pieEditability(parsePie(source));
    return editability.editable
      ? { editable: true }
      : {
          editable: false,
          reason: editability.reason,
          detail: editability.detail,
          unsupported:
            editability.reason === "unsupportedLines" ? editability.lines : [],
        };
  },
};
