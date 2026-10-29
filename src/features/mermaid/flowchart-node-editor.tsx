import type { MutableRefObject, Ref } from "react";
import type { ApplyDiagramEditsOutcome } from "../../application/diagram/apply-diagram-edits";
import type { OperationResult } from "../../application/ports/operation-error";
import { FLOWCHART_EDITABLE_SHAPES } from "../../domain/diagram/flowchart/flowchart-operation-config";
import type { FlowchartOperation } from "../../domain/diagram/flowchart/flowchart-operations";
import type { FlowchartNodeView } from "../../domain/diagram/flowchart/flowchart-view";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { describeRestriction } from "./diagram-gui-text";
import { FlowchartLabelField } from "./flowchart-label-field";
import { GuiSelect } from "./gui-controls";
import type { GuiDraftCommit } from "./use-gui-field-draft";

export interface FlowchartNodeEditorProps {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly node: FlowchartNodeView | undefined;
  readonly busy: boolean;
  readonly runDraft: (
    operation: FlowchartOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  readonly onInvalidInput: (message: string) => void;
  readonly labelInputRef: Ref<HTMLInputElement | HTMLTextAreaElement>;
  readonly commitPendingRef: MutableRefObject<GuiDraftCommit | null>;
}

// The default shown for a node that was never given a shape (Mermaid draws a rectangle).
const UNSHAPED_NODE_SHAPE = "square";

export function FlowchartNodeEditor({
  documentId,
  blockId,
  node,
  busy,
  runDraft,
  onInvalidInput,
  labelInputRef,
  commitPendingRef,
}: FlowchartNodeEditorProps) {
  const gui = useMessages().mermaid.gui;
  const text = gui.flowchart;
  const restrictionText = describeRestriction(gui, node?.restriction ?? null);
  const unavailable = busy || node === undefined || node.restriction !== null;
  return (
    <div className="diagram-gui__editor">
      <h4 className="diagram-gui__heading">{text.selectedNodeHeading}</h4>
      {node === undefined && (
        <p className="diagram-gui__hint">{text.itemGone}</p>
      )}
      <FlowchartLabelField
        documentId={documentId}
        blockId={blockId}
        label={text.nodeLabelField}
        target={node}
        targetKey={(target) => target.id}
        committed={node?.displayLabel ?? ""}
        buildOperation={(target, label) => ({
          kind: "setNodeLabel",
          nodeId: target.id,
          label,
        })}
        allowEmpty={false}
        restrictionText={restrictionText}
        busy={busy}
        runDraft={runDraft}
        onInvalidInput={onInvalidInput}
        inputRef={labelInputRef}
        commitPendingRef={commitPendingRef}
      />
      <GuiSelect
        label={text.shapeField}
        value={node?.shape ?? UNSHAPED_NODE_SHAPE}
        options={FLOWCHART_EDITABLE_SHAPES.map((shape) => ({
          value: shape,
          label: text.shapes[shape],
        }))}
        disabled={unavailable}
        onChange={(shape) => {
          if (node === undefined) return;
          const editable = FLOWCHART_EDITABLE_SHAPES.find(
            (candidate) => candidate === shape,
          );
          if (editable === undefined) return;
          void runDraft({
            kind: "setNodeShape",
            nodeId: node.id,
            shape: editable,
          });
        }}
      />
    </div>
  );
}
