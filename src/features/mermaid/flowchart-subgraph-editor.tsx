import { type MutableRefObject, type Ref, useId } from "react";
import type { ApplyDiagramEditsOutcome } from "../../application/diagram/apply-diagram-edits";
import type { OperationResult } from "../../application/ports/operation-error";
import type { FlowchartDirection } from "../../domain/diagram/flowchart/flowchart-config";
import type { FlowchartOperation } from "../../domain/diagram/flowchart/flowchart-operations";
import type { FlowchartSubgraphView } from "../../domain/diagram/flowchart/flowchart-view";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { describeRestriction } from "./diagram-gui-text";
import { FlowchartLabelField } from "./flowchart-label-field";
import { oneLine } from "./flowchart-node-list";
import { GuiButton, GuiSelect } from "./gui-controls";
import type { GuiDraftCommit } from "./use-gui-field-draft";

export interface FlowchartSubgraphEditorProps {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly subgraph: FlowchartSubgraphView | undefined;
  readonly busy: boolean;
  readonly runDraft: (
    operation: FlowchartOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  readonly onInvalidInput: (message: string) => void;
  // Called with the focus already moved off the controls the dissolve removes.
  readonly onDissolve: () => Promise<void>;
  readonly labelInputRef: Ref<HTMLInputElement | HTMLTextAreaElement>;
  readonly commitPendingRef: MutableRefObject<GuiDraftCommit | null>;
}

const SUBGRAPH_DIRECTIONS: readonly FlowchartDirection[] = [
  "TB",
  "BT",
  "LR",
  "RL",
];
// The value of the direction choice that removes the direction line.
const NO_DIRECTION = "";

export function FlowchartSubgraphEditor({
  documentId,
  blockId,
  subgraph,
  busy,
  runDraft,
  onInvalidInput,
  onDissolve,
  labelInputRef,
  commitPendingRef,
}: FlowchartSubgraphEditorProps) {
  const gui = useMessages().mermaid.gui;
  const text = gui.flowchart;
  const hintId = useId();
  const dissolveReason = describeRestriction(
    gui,
    subgraph?.dissolveRestriction ?? null,
  );
  const members =
    subgraph === undefined || subgraph.memberLabels.length === 0
      ? text.noMembers
      : subgraph.memberLabels.map(oneLine).join(text.memberSeparator);
  return (
    <div className="diagram-gui__editor">
      <h4 className="diagram-gui__heading">{text.selectedSubgraphHeading}</h4>
      {subgraph === undefined && (
        <p className="diagram-gui__hint">{text.itemGone}</p>
      )}
      <FlowchartLabelField
        documentId={documentId}
        blockId={blockId}
        label={text.subgraphTitleField}
        target={subgraph}
        targetKey={(target) => target.id}
        committed={subgraph?.title ?? ""}
        buildOperation={(target, title) => ({
          kind: "setSubgraphTitle",
          subgraphId: target.id,
          title,
        })}
        allowEmpty={false}
        restrictionText={null}
        busy={busy}
        runDraft={runDraft}
        onInvalidInput={onInvalidInput}
        inputRef={labelInputRef}
        commitPendingRef={commitPendingRef}
      />
      <GuiSelect
        label={text.subgraphDirectionField}
        value={subgraph?.direction ?? NO_DIRECTION}
        options={[
          { value: NO_DIRECTION, label: text.subgraphDirectionNone },
          ...SUBGRAPH_DIRECTIONS.map((direction) => ({
            value: direction,
            label: text.directions[direction],
          })),
        ]}
        disabled={busy || subgraph === undefined}
        onChange={(value) => {
          if (subgraph === undefined) return;
          const direction =
            value === NO_DIRECTION
              ? null
              : SUBGRAPH_DIRECTIONS.find((candidate) => candidate === value);
          if (direction === undefined) return;
          void runDraft({
            kind: "setSubgraphDirection",
            subgraphId: subgraph.id,
            direction,
          });
        }}
      />
      <p className="diagram-gui__hint">
        {text.subgraphMembersLabel}
        {": "}
        {members}
      </p>
      {dissolveReason !== null ? (
        <p id={hintId} className="diagram-gui__hint">
          {dissolveReason}
        </p>
      ) : (
        <p id={hintId} className="diagram-gui__hint">
          {text.dissolveNote}
        </p>
      )}
      <div className="diagram-gui__actions">
        <GuiButton
          label={text.dissolveSubgraph}
          variant="danger"
          disabled={busy || subgraph === undefined || dissolveReason !== null}
          reasonId={hintId}
          onPress={() => void onDissolve()}
        />
      </div>
    </div>
  );
}
