import { type MutableRefObject, type Ref, useId, useRef } from "react";
import type { ApplyDiagramEditsOutcome } from "../../application/diagram/apply-diagram-edits";
import type { OperationResult } from "../../application/ports/operation-error";
import type { GanttOperation } from "../../domain/diagram/gantt/gantt-operations";
import type { GanttSectionView } from "../../domain/diagram/gantt/gantt-view";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { describeRestriction } from "./diagram-gui-text";
import { sectionKey } from "./gantt-task-text";
import { GuiButton } from "./gui-controls";
import { GuiDraftLabelField } from "./gui-draft-label-field";
import type { GuiDraftCommit } from "./use-gui-field-draft";

export interface GanttSectionEditorProps {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly section: GanttSectionView | undefined;
  readonly busy: boolean;
  readonly runDraft: (
    operation: GanttOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  readonly onInvalidInput: (message: string) => void;
  readonly onDelete: (section: GanttSectionView) => void;
  readonly nameInputRef: Ref<HTMLInputElement | HTMLTextAreaElement>;
  readonly commitPendingRef: MutableRefObject<GuiDraftCommit | null>;
}

export function GanttSectionEditor({
  documentId,
  blockId,
  section,
  busy,
  runDraft,
  onInvalidInput,
  onDelete,
  nameInputRef,
  commitPendingRef,
}: GanttSectionEditorProps) {
  const gui = useMessages().mermaid.gui;
  const text = gui.gantt;
  const hintId = useId();
  // The section as it was last seen: when the selection stops resolving (an undo, or an edit
  // in Source), the field stays on screen with its text, as the other editors do.
  const lastSectionRef = useRef<GanttSectionView | undefined>(section);
  if (section !== undefined) lastSectionRef.current = section;
  const deleteReason = describeRestriction(
    gui,
    section?.deleteRestriction ?? null,
    text.refusalReasons,
  );
  return (
    <div className="diagram-gui__editor">
      <h4 className="diagram-gui__heading">{text.selectedSectionHeading}</h4>
      {section === undefined && (
        <p className="diagram-gui__hint">{text.itemGone}</p>
      )}
      <GuiDraftLabelField
        documentId={documentId}
        blockId={blockId}
        label={text.sectionNameField}
        target={section}
        targetKey={sectionKey}
        committed={(section ?? lastSectionRef.current)?.target.name ?? ""}
        buildOperation={(target, name): GanttOperation => ({
          kind: "renameSection",
          target: target.target,
          name,
        })}
        allowEmpty
        multiline={false}
        restrictionText={null}
        itemChangedText={text.itemChanged}
        busy={busy}
        runDraft={runDraft}
        onInvalidInput={onInvalidInput}
        inputRef={nameInputRef}
        commitPendingRef={commitPendingRef}
      />
      <div className="diagram-gui__actions">
        <GuiButton
          label={text.deleteSection}
          variant="danger"
          disabled={busy || section === undefined || deleteReason !== null}
          reasonId={hintId}
          onPress={() => {
            if (section !== undefined) onDelete(section);
          }}
        />
      </div>
      {deleteReason !== null && (
        <p id={hintId} className="diagram-gui__hint">
          {deleteReason}
        </p>
      )}
    </div>
  );
}
