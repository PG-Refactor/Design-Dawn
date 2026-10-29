import { type MutableRefObject, type Ref, useId } from "react";
import type { ApplyDiagramEditsOutcome } from "../../application/diagram/apply-diagram-edits";
import type { OperationResult } from "../../application/ports/operation-error";
import {
  FLOWCHART_MAX_LINK_LENGTH,
  type FlowchartLinkStroke,
  type FlowchartLinkType,
} from "../../domain/diagram/flowchart/flowchart-config";
import {
  FLOWCHART_INVISIBLE_LINK_TYPE,
  FLOWCHART_LINK_STROKES,
  FLOWCHART_LINK_TYPES,
  FLOWCHART_MIN_LINK_LENGTH,
} from "../../domain/diagram/flowchart/flowchart-operation-config";
import type {
  FlowchartLinkChange,
  FlowchartOperation,
} from "../../domain/diagram/flowchart/flowchart-operations";
import type {
  FlowchartEdgeView,
  FlowchartNodeView,
} from "../../domain/diagram/flowchart/flowchart-view";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { describeRestriction } from "./diagram-gui-text";
import { FlowchartLabelField } from "./flowchart-label-field";
import { oneLine } from "./flowchart-node-list";
import { GuiButton, GuiSelect } from "./gui-controls";
import type { GuiDraftCommit } from "./use-gui-field-draft";

export interface FlowchartEdgeEditorProps {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly edge: FlowchartEdgeView | undefined;
  readonly nodes: readonly FlowchartNodeView[];
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

const targetOf = (edge: FlowchartEdgeView) => ({
  index: edge.index,
  id: edge.id,
});

function pickFrom<T extends string>(
  allowed: readonly T[],
  value: string,
): T | undefined {
  return allowed.find((candidate) => candidate === value);
}

export function FlowchartEdgeEditor({
  documentId,
  blockId,
  edge,
  nodes,
  busy,
  runDraft,
  onInvalidInput,
  onDelete,
  labelInputRef,
  commitPendingRef,
}: FlowchartEdgeEditorProps) {
  const gui = useMessages().mermaid.gui;
  const text = gui.flowchart;
  const restrictionHintId = useId();
  const endHintId = useId();
  const restriction = describeRestriction(gui, edge?.restriction ?? null);
  const labelRestriction = describeRestriction(
    gui,
    edge?.restriction ?? edge?.labelRestriction ?? null,
  );
  const unavailable = busy || edge === undefined || edge.restriction !== null;

  function changeLink(change: Partial<FlowchartLinkChange>): void {
    if (edge === undefined) return;
    void runDraft({
      kind: "setEdgeKind",
      target: targetOf(edge),
      link: {
        type: change.type ?? edge.type,
        stroke: change.stroke ?? edge.stroke,
        length: change.length ?? edge.length,
      },
    });
  }
  function reconnect(end: "start" | "end", nodeId: string): void {
    if (edge === undefined) return;
    void runDraft({
      kind: "reconnectEdge",
      target: targetOf(edge),
      end,
      nodeId,
    });
  }

  const nodeOptions = nodes.map((node) => ({
    value: node.id,
    label: text.nodeOption(oneLine(node.displayLabel), node.id),
  }));
  return (
    <div className="diagram-gui__editor">
      <h4 className="diagram-gui__heading">{text.selectedEdgeHeading}</h4>
      {edge === undefined && (
        <p className="diagram-gui__hint">{text.itemGone}</p>
      )}
      <FlowchartLabelField
        documentId={documentId}
        blockId={blockId}
        label={text.edgeLabelField}
        target={edge}
        targetKey={(target) => `${target.index}:${target.id}`}
        committed={edge?.displayLabel ?? ""}
        buildOperation={(target, label) => ({
          kind: "setEdgeLabel",
          target: targetOf(target),
          label: label === "" ? null : label,
        })}
        allowEmpty
        restrictionText={labelRestriction}
        busy={busy}
        runDraft={runDraft}
        onInvalidInput={onInvalidInput}
        inputRef={labelInputRef}
        commitPendingRef={commitPendingRef}
      />
      <GuiSelect
        label={text.arrowField}
        value={edge?.type ?? ""}
        options={FLOWCHART_LINK_TYPES.map((type) => ({
          value: type,
          label: text.arrows[type],
        }))}
        disabled={unavailable}
        reasonId={restrictionHintId}
        onChange={(value) => {
          const type: FlowchartLinkType | undefined = pickFrom(
            FLOWCHART_LINK_TYPES,
            value,
          );
          if (type !== undefined) changeLink({ type });
        }}
      />
      <GuiSelect
        label={text.strokeField}
        value={edge?.stroke ?? ""}
        options={FLOWCHART_LINK_STROKES.map((stroke) => ({
          value: stroke,
          label: text.strokes[stroke],
        }))}
        disabled={unavailable}
        reasonId={restrictionHintId}
        onChange={(value) => {
          const stroke: FlowchartLinkStroke | undefined = pickFrom(
            FLOWCHART_LINK_STROKES,
            value,
          );
          if (stroke === undefined) return;
          // An invisible line has no arrow end: switching to it sets that too.
          changeLink(
            stroke === "invisible"
              ? { stroke, type: FLOWCHART_INVISIBLE_LINK_TYPE }
              : { stroke },
          );
        }}
      />
      <GuiSelect
        label={text.lengthField}
        value={String(edge?.length ?? "")}
        options={Array.from(
          { length: FLOWCHART_MAX_LINK_LENGTH - FLOWCHART_MIN_LINK_LENGTH + 1 },
          (_, offset) => String(FLOWCHART_MIN_LINK_LENGTH + offset),
        ).map((length) => ({ value: length, label: length }))}
        disabled={unavailable}
        reasonId={restrictionHintId}
        onChange={(value) => changeLink({ length: Number(value) })}
      />
      <GuiSelect
        label={text.startField}
        value={edge?.start ?? ""}
        options={nodeOptions}
        disabled={unavailable || edge?.canReconnectStart !== true}
        reasonId={edge?.restriction === null ? endHintId : restrictionHintId}
        onChange={(nodeId) => reconnect("start", nodeId)}
      />
      <GuiSelect
        label={text.endField}
        value={edge?.end ?? ""}
        options={nodeOptions}
        disabled={unavailable || edge?.canReconnectEnd !== true}
        reasonId={edge?.restriction === null ? endHintId : restrictionHintId}
        onChange={(nodeId) => reconnect("end", nodeId)}
      />
      {restriction !== null && (
        <p id={restrictionHintId} className="diagram-gui__hint">
          {restriction}
        </p>
      )}
      {edge?.restriction === null &&
        (!edge.canReconnectStart || !edge.canReconnectEnd) && (
          <p id={endHintId} className="diagram-gui__hint">
            {text.edgeEndShared}
          </p>
        )}
      <div className="diagram-gui__actions">
        <GuiButton
          label={text.deleteEdge}
          variant="danger"
          disabled={unavailable}
          reasonId={restrictionHintId}
          onPress={() => void onDelete()}
        />
      </div>
    </div>
  );
}
