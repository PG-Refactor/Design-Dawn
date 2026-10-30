import type { MutableRefObject, Ref } from "react";
import type { ApplyDiagramEditsOutcome } from "../../application/diagram/apply-diagram-edits";
import type { OperationResult } from "../../application/ports/operation-error";
import { SEQUENCE_PARTICIPANT_KINDS } from "../../domain/diagram/sequence/sequence-config";
import type { SequenceOperation } from "../../domain/diagram/sequence/sequence-operations";
import type { SequenceParticipantView } from "../../domain/diagram/sequence/sequence-view";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { describeRestriction } from "./diagram-gui-text";
import { GuiSelect } from "./gui-controls";
import { GuiDraftLabelField } from "./gui-draft-label-field";
import type { GuiDraftCommit } from "./use-gui-field-draft";

export interface SequenceParticipantEditorProps {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly participant: SequenceParticipantView | undefined;
  readonly busy: boolean;
  readonly runDraft: (
    operation: SequenceOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  readonly onInvalidInput: (message: string) => void;
  readonly labelInputRef: Ref<HTMLInputElement | HTMLTextAreaElement>;
  readonly commitPendingRef: MutableRefObject<GuiDraftCommit | null>;
}

export function SequenceParticipantEditor({
  documentId,
  blockId,
  participant,
  busy,
  runDraft,
  onInvalidInput,
  labelInputRef,
  commitPendingRef,
}: SequenceParticipantEditorProps) {
  const gui = useMessages().mermaid.gui;
  const text = gui.sequence;
  const restrictionText = describeRestriction(
    gui,
    participant?.restriction ?? null,
  );
  return (
    <div className="diagram-gui__editor">
      <h4 className="diagram-gui__heading">
        {text.selectedParticipantHeading}
      </h4>
      {participant === undefined && (
        <p className="diagram-gui__hint">{text.itemGone}</p>
      )}
      <GuiDraftLabelField
        documentId={documentId}
        blockId={blockId}
        label={text.participantLabelField}
        target={participant}
        targetKey={(target) => target.id}
        committed={participant?.displayLabel ?? ""}
        buildOperation={(target, label): SequenceOperation => ({
          kind: "renameParticipantLabel",
          participantId: target.id,
          label,
        })}
        allowEmpty={false}
        multiline={false}
        restrictionText={restrictionText}
        itemChangedText={text.itemChanged}
        busy={busy}
        runDraft={runDraft}
        onInvalidInput={onInvalidInput}
        inputRef={labelInputRef}
        commitPendingRef={commitPendingRef}
      />
      <GuiSelect
        label={text.kindField}
        value={participant?.kind ?? ""}
        options={SEQUENCE_PARTICIPANT_KINDS.map((kind) => ({
          value: kind,
          label: text.kinds[kind],
        }))}
        disabled={busy || participant === undefined}
        onChange={(value) => {
          const kind = SEQUENCE_PARTICIPANT_KINDS.find(
            (candidate) => candidate === value,
          );
          if (participant === undefined || kind === undefined) return;
          void runDraft({
            kind: "changeParticipantKind",
            participantId: participant.id,
            participantKind: kind,
          });
        }}
      />
    </div>
  );
}
