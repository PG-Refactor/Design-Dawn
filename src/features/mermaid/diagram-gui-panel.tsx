import { type MutableRefObject, useMemo } from "react";
import { analyzeDiagramSource } from "../../domain/diagram/diagram-source";
import { useMessages } from "../workspace/use-messages";
import { describeNotEditable } from "./diagram-gui-text";
import "./diagram-gui.css";
import { FlowchartGuiPanel } from "./flowchart-gui-panel";
import { GanttGuiPanel } from "./gantt-gui-panel";
import { PieGuiPanel } from "./pie-gui-panel";
import { SequenceGuiPanel } from "./sequence-gui-panel";
import type { DiagramOperationTarget } from "./use-diagram-operation";
import type { GuiDraftCommit } from "./use-gui-field-draft";

export interface DiagramGuiPanelProps {
  readonly target: DiagramOperationTarget;
  readonly shortId: string;
  // The block's committed text.
  readonly source: string;
  readonly onShowSource: () => void;
  // The editor of the diagram type fills it with what must happen before Source is shown.
  readonly leaveRef: MutableRefObject<GuiDraftCommit | null>;
}

// The GUI side of the Mermaid editor: the editor of the diagram's type when the committed
// text is one it can edit safely, and otherwise the reason it cannot, with a way out. The
// choice is made from the committed text every render, so undo, redo and Source edits are
// picked up without any state of this panel.
export function DiagramGuiPanel({
  target,
  shortId,
  source,
  onShowSource,
  leaveRef,
}: DiagramGuiPanelProps) {
  const gui = useMessages().mermaid.gui;
  const analysis = useMemo(() => analyzeDiagramSource(source), [source]);
  const { editability } = analysis;

  return (
    <section aria-label={gui.panelLabel(shortId)} className="diagram-gui">
      {editability.editable && editability.type === "pie" ? (
        <PieGuiPanel
          target={target}
          shortId={shortId}
          source={source}
          leaveRef={leaveRef}
        />
      ) : editability.editable && editability.type === "flowchart" ? (
        <FlowchartGuiPanel
          target={target}
          shortId={shortId}
          source={source}
          leaveRef={leaveRef}
        />
      ) : editability.editable && editability.type === "sequence" ? (
        <SequenceGuiPanel
          target={target}
          shortId={shortId}
          source={source}
          leaveRef={leaveRef}
        />
      ) : editability.editable && editability.type === "gantt" ? (
        <GanttGuiPanel
          target={target}
          shortId={shortId}
          source={source}
          leaveRef={leaveRef}
        />
      ) : (
        <NotEditable
          text={describeNotEditable(
            gui,
            editability.editable
              ? { editable: false, reason: "noEditorForType" }
              : editability,
          )}
          onShowSource={onShowSource}
        />
      )}
    </section>
  );
}

function NotEditable({
  text,
  onShowSource,
}: {
  readonly text: ReturnType<typeof describeNotEditable>;
  readonly onShowSource: () => void;
}) {
  const gui = useMessages().mermaid.gui;
  return (
    <div className="diagram-gui__not-editable">
      <h4 className="diagram-gui__heading">{gui.notEditableTitle}</h4>
      <p>
        <span className="diagram-gui__field-label">
          {gui.notEditableReasonLabel}
        </span>
        {text.reason}
      </p>
      {text.detail !== null && (
        <p className="diagram-gui__hint">
          <span className="diagram-gui__field-label">
            {gui.notEditableDetailLabel}
          </span>
          {text.detail}
        </p>
      )}
      <button type="button" className="button" onClick={onShowSource}>
        {gui.switchToSource}
      </button>
    </div>
  );
}
