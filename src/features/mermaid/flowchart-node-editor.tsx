import { type MutableRefObject, type Ref, useId } from "react";
import type { ApplyDiagramEditsOutcome } from "../../application/diagram/apply-diagram-edits";
import type { OperationResult } from "../../application/ports/operation-error";
import { FLOWCHART_EDITABLE_SHAPES } from "../../domain/diagram/flowchart/flowchart-operation-config";
import type { FlowchartOperation } from "../../domain/diagram/flowchart/flowchart-operations";
import type {
  FlowchartNodeActions,
  FlowchartNodeView,
  FlowchartSubgraphView,
} from "../../domain/diagram/flowchart/flowchart-view";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { describeRestriction } from "./diagram-gui-text";
import { FlowchartLabelField } from "./flowchart-label-field";
import { oneLine } from "./flowchart-node-list";
import { GuiButton, GuiSelect } from "./gui-controls";
import type { GuiDraftCommit } from "./use-gui-field-draft";

export interface FlowchartNodeEditorProps {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly node: FlowchartNodeView | undefined;
  // What can be done with the node besides editing its text; null when it cannot be found.
  readonly actions: FlowchartNodeActions | null;
  readonly subgraphs: readonly FlowchartSubgraphView[];
  readonly busy: boolean;
  readonly runDraft: (
    operation: FlowchartOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  readonly onInvalidInput: (message: string) => void;
  // Called with the focus already moved off the controls the delete removes.
  readonly onDelete: () => Promise<void>;
  readonly labelInputRef: Ref<HTMLInputElement | HTMLTextAreaElement>;
  readonly commitPendingRef: MutableRefObject<GuiDraftCommit | null>;
}

// The default shown for a node that was never given a shape (Mermaid draws a rectangle).
const UNSHAPED_NODE_SHAPE = "square";
// The value of the choice that takes the node out of its subgraph.
const NO_SUBGRAPH = "";

export function FlowchartNodeEditor({
  documentId,
  blockId,
  node,
  actions,
  subgraphs,
  busy,
  runDraft,
  onInvalidInput,
  onDelete,
  labelInputRef,
  commitPendingRef,
}: FlowchartNodeEditorProps) {
  const gui = useMessages().mermaid.gui;
  const text = gui.flowchart;
  const deleteHintId = useId();
  const deleteReason = describeRestriction(
    gui,
    actions?.deleteRestriction ?? null,
  );
  const membershipUnavailable = busy || node === undefined || actions === null;
  // A choice that would be refused is offered greyed out with the reason in its text.
  function subgraphChoice(
    value: string,
    label: string,
    restriction: string | null | undefined,
  ) {
    const reason = describeRestriction(gui, restriction ?? null);
    return reason === null
      ? { value, label }
      : { value, label: text.unavailableOption(label, reason), disabled: true };
  }
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
      <div className="diagram-gui__row">
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
        <GuiSelect
          label={text.nodeSubgraphField}
          value={actions?.ownerId ?? NO_SUBGRAPH}
          options={[
            subgraphChoice(
              NO_SUBGRAPH,
              text.nodeSubgraphNone,
              actions?.ownerId == null ? null : actions.removeRestriction,
            ),
            ...subgraphs.map((subgraph) =>
              subgraphChoice(
                subgraph.id,
                text.nodeOption(oneLine(subgraph.title), subgraph.id),
                actions?.moveRestrictions[subgraph.id],
              ),
            ),
          ]}
          disabled={membershipUnavailable}
          onChange={(value) => {
            if (node === undefined || actions === null) return;
            if (value === NO_SUBGRAPH) {
              if (actions.ownerId === null) return;
              void runDraft({
                kind: "removeNodeFromSubgraph",
                nodeId: node.id,
                subgraphId: actions.ownerId,
              });
              return;
            }
            void runDraft({
              kind: "moveNodeToSubgraph",
              nodeId: node.id,
              subgraphId: value,
            });
          }}
        />
      </div>
      {/* The note goes beside the button it is about. */}
      <div className="diagram-gui__actions">
        <GuiButton
          label={text.deleteNode}
          variant="danger"
          disabled={membershipUnavailable || deleteReason !== null}
          reasonId={deleteHintId}
          onPress={() => void onDelete()}
        />
        {deleteReason !== null ? (
          <p id={deleteHintId} className="diagram-gui__hint">
            {deleteReason}
          </p>
        ) : (
          actions !== null &&
          actions.edgeCount > 0 && (
            <p id={deleteHintId} className="diagram-gui__hint">
              {text.deleteNodeEdges(actions.edgeCount)}
            </p>
          )
        )}
      </div>
    </div>
  );
}
