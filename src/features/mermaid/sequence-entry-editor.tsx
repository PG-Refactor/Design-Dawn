import { type MutableRefObject, type Ref, useId, useRef } from "react";
import type { ApplyDiagramEditsOutcome } from "../../application/diagram/apply-diagram-edits";
import type { OperationResult } from "../../application/ports/operation-error";
import {
  SEQUENCE_ARROWS,
  SEQUENCE_NOTE_PLACEMENTS,
} from "../../domain/diagram/sequence/sequence-config";
import type { SequenceOperation } from "../../domain/diagram/sequence/sequence-operations";
import type { SequenceEntryView } from "../../domain/diagram/sequence/sequence-view";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { describeRestriction } from "./diagram-gui-text";
import { GuiButton, GuiSelect } from "./gui-controls";
import { GuiDraftLabelField } from "./gui-draft-label-field";
import { entryKey } from "./sequence-entry-text";
import type { GuiDraftCommit } from "./use-gui-field-draft";

export interface SequenceEntryEditorProps {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly entry: SequenceEntryView | undefined;
  readonly busy: boolean;
  readonly run: (operation: SequenceOperation) => Promise<unknown>;
  readonly runDraft: (
    operation: SequenceOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  readonly onInvalidInput: (message: string) => void;
  readonly onDelete: (entry: SequenceEntryView) => void;
  readonly labelInputRef: Ref<HTMLInputElement | HTMLTextAreaElement>;
  readonly commitPendingRef: MutableRefObject<GuiDraftCommit | null>;
}

export function SequenceEntryEditor({
  documentId,
  blockId,
  entry,
  busy,
  run,
  runDraft,
  onInvalidInput,
  onDelete,
  labelInputRef,
  commitPendingRef,
}: SequenceEntryEditorProps) {
  const gui = useMessages().mermaid.gui;
  const text = gui.sequence;
  const hintId = useId();
  // The entry as it was last seen: when the selection stops resolving (an undo, or an edit in
  // Source), the field stays on screen with its pending text, as the other editors do.
  const lastEntryRef = useRef<SequenceEntryView | undefined>(entry);
  if (entry !== undefined) lastEntryRef.current = entry;
  const shown = entry ?? lastEntryRef.current;
  if (shown === undefined) {
    return (
      <div className="diagram-gui__editor">
        <h4 className="diagram-gui__heading">{text.selectedEntryHeading}</h4>
        <p className="diagram-gui__hint">{text.itemGone}</p>
      </div>
    );
  }
  if (shown.kind === "blockEnd") {
    return (
      <div className="diagram-gui__editor">
        <h4 className="diagram-gui__heading">{text.selectedEntryHeading}</h4>
        <p className="diagram-gui__hint">
          {entry === undefined ? text.itemGone : text.blockEndHint}
        </p>
      </div>
    );
  }
  const textRestriction = describeRestriction(gui, shown.textRestriction);
  const fieldLabel =
    shown.kind === "message"
      ? text.messageTextField
      : shown.kind === "note"
        ? text.noteTextField
        : text.blockTextField;
  const reasons: (string | null)[] = [];
  if (shown.kind === "message") {
    reasons.push(
      describeRestriction(gui, shown.moveUpRestriction),
      describeRestriction(gui, shown.moveDownRestriction),
      describeRestriction(gui, shown.deleteRestriction),
    );
  } else if (shown.kind === "note") {
    reasons.push(describeRestriction(gui, shown.deleteRestriction));
  }
  const shownReasons = [
    ...new Set(reasons.filter((reason) => reason !== null)),
  ];
  // The controls that act on the entry need it to resolve right now.
  const unavailable = busy || entry === undefined;
  return (
    <div className="diagram-gui__editor">
      <h4 className="diagram-gui__heading">{text.selectedEntryHeading}</h4>
      {entry === undefined && (
        <p className="diagram-gui__hint">{text.itemGone}</p>
      )}
      <GuiDraftLabelField
        documentId={documentId}
        blockId={blockId}
        label={fieldLabel}
        target={entry}
        targetKey={entryKey}
        committed={shown.displayText}
        buildOperation={(target, value): SequenceOperation => {
          const sent = { target: target.target, text: value };
          switch (target.kind) {
            case "message":
              return { kind: "editMessageText", ...sent };
            case "note":
              return { kind: "editNoteText", ...sent };
            default:
              return { kind: "editBlockText", ...sent };
          }
        }}
        allowEmpty
        multiline={shown.kind !== "blockStart" && shown.kind !== "branch"}
        restrictionText={textRestriction}
        itemChangedText={text.itemChanged}
        busy={busy}
        runDraft={runDraft}
        onInvalidInput={onInvalidInput}
        inputRef={labelInputRef}
        commitPendingRef={commitPendingRef}
      />
      {shown.kind === "message" && (
        <>
          <GuiSelect
            label={text.arrowField}
            value={shown.arrow}
            options={SEQUENCE_ARROWS.map((arrow) => ({
              value: arrow,
              label: text.arrows[arrow],
            }))}
            disabled={unavailable}
            onChange={(value) => {
              const arrow = SEQUENCE_ARROWS.find(
                (candidate) => candidate === value,
              );
              if (arrow === undefined || entry?.kind !== "message") return;
              void runDraft({
                kind: "changeArrow",
                target: entry.target,
                arrow,
              });
            }}
          />
          <div className="diagram-gui__actions">
            <GuiButton
              label={text.moveUp}
              disabled={unavailable || shown.moveUpRestriction !== null}
              reasonId={hintId}
              onPress={() => {
                if (entry?.kind !== "message") return;
                void run({
                  kind: "moveMessage",
                  target: entry.target,
                  direction: "up",
                });
              }}
            />
            <GuiButton
              label={text.moveDown}
              disabled={unavailable || shown.moveDownRestriction !== null}
              reasonId={hintId}
              onPress={() => {
                if (entry?.kind !== "message") return;
                void run({
                  kind: "moveMessage",
                  target: entry.target,
                  direction: "down",
                });
              }}
            />
          </div>
        </>
      )}
      {shown.kind === "note" && (
        <GuiSelect
          label={text.placementField}
          value={shown.placement}
          options={SEQUENCE_NOTE_PLACEMENTS.map((placement) => ({
            value: placement,
            label: text.placements[placement],
          }))}
          disabled={unavailable}
          onChange={(value) => {
            const placement = SEQUENCE_NOTE_PLACEMENTS.find(
              (candidate) => candidate === value,
            );
            if (placement === undefined || entry?.kind !== "note") return;
            void runDraft({
              kind: "changeNotePlacement",
              target: entry.target,
              placement,
            });
          }}
        />
      )}
      {shownReasons.length > 0 && (
        <p id={hintId} className="diagram-gui__hint">
          {shownReasons.map((reason) => (
            <span key={reason} className="diagram-gui__reason">
              {reason}{" "}
            </span>
          ))}
        </p>
      )}
      {(shown.kind === "message" || shown.kind === "note") && (
        <div className="diagram-gui__actions">
          <GuiButton
            label={
              shown.kind === "message" ? text.deleteMessage : text.deleteNote
            }
            variant="danger"
            disabled={unavailable || shown.deleteRestriction !== null}
            reasonId={hintId}
            onPress={() => {
              if (entry !== undefined) onDelete(entry);
            }}
          />
        </div>
      )}
    </div>
  );
}
