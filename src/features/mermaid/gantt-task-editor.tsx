import {
  type MutableRefObject,
  type Ref,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { ApplyDiagramEditsOutcome } from "../../application/diagram/apply-diagram-edits";
import {
  type OperationResult,
  operationOk,
} from "../../application/ports/operation-error";
import { GANTT_TAGS } from "../../domain/diagram/gantt/gantt-config";
import {
  ganttEndInputOf,
  ganttStartInputOf,
} from "../../domain/diagram/gantt/gantt-input";
import type { GanttMoveDirection } from "../../domain/diagram/gantt/gantt-move-operations";
import type { GanttOperation } from "../../domain/diagram/gantt/gantt-operations";
import type {
  GanttMoveTargetView,
  GanttTaskView,
} from "../../domain/diagram/gantt/gantt-view";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { describeRestriction } from "./diagram-gui-text";
import { GanttActionButton } from "./gantt-action-button";
import { taskKey } from "./gantt-task-text";
import { GuiButton, GuiCheckbox, GuiSelect } from "./gui-controls";
import { GuiDraftLabelField } from "./gui-draft-label-field";
import type { GuiDraftCommit } from "./use-gui-field-draft";

export interface GanttTaskEditorProps {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly task: GanttTaskView | undefined;
  // The chart's date format, shown in the hints.
  readonly dateFormat: string;
  readonly busy: boolean;
  readonly runDraft: (
    operation: GanttOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  readonly onInvalidInput: (message: string) => void;
  readonly onDelete: (task: GanttTaskView) => void;
  readonly onMove: (task: GanttTaskView, direction: GanttMoveDirection) => void;
  readonly onMoveToSection: (task: GanttTaskView, sectionIndex: number) => void;
  readonly onDuplicate: (task: GanttTaskView) => void;
  // The sections the task could move to, with whether each move is possible.
  readonly moveTargets: readonly GanttMoveTargetView[];
  readonly nameInputRef: Ref<HTMLInputElement | HTMLTextAreaElement>;
  readonly commitPendingRef: MutableRefObject<GuiDraftCommit | null>;
}

// The fields of one task. Each has its own draft; "commit what is pending" runs them one
// after the other, the name last, because the other operations name the task by its current
// name and a rename would make their target stale.
export function GanttTaskEditor({
  documentId,
  blockId,
  task,
  dateFormat,
  busy,
  runDraft,
  onInvalidInput,
  onDelete,
  onMove,
  onMoveToSection,
  onDuplicate,
  moveTargets,
  nameInputRef,
  commitPendingRef,
}: GanttTaskEditorProps) {
  const gui = useMessages().mermaid.gui;
  const text = gui.gantt;
  const hintId = useId();
  // The task as it was last seen: when the selection stops resolving (an undo, or an edit in
  // Source), the fields stay on screen with their pending text, as the other editors do.
  const lastTaskRef = useRef<GanttTaskView | undefined>(task);
  if (task !== undefined) lastTaskRef.current = task;
  const shown = task ?? lastTaskRef.current;
  const idCommitRef = useRef<GuiDraftCommit | null>(null);
  const startCommitRef = useRef<GuiDraftCommit | null>(null);
  const endCommitRef = useRef<GuiDraftCommit | null>(null);
  const nameCommitRef = useRef<GuiDraftCommit | null>(null);
  const linkCommitRef = useRef<GuiDraftCommit | null>(null);
  const [destination, setDestination] = useState("");
  // Every render: the ref is also restored after the simulated unmount of StrictMode.
  useEffect(() => {
    commitPendingRef.current = async () => {
      for (const commit of [
        idCommitRef,
        startCommitRef,
        endCommitRef,
        linkCommitRef,
        nameCommitRef,
      ]) {
        const result = await commit.current?.();
        if (result !== undefined && !result.ok) return result;
      }
      return operationOk(undefined);
    };
    return () => {
      commitPendingRef.current = null;
    };
  });

  if (shown === undefined) {
    return (
      <div className="diagram-gui__editor">
        <h4 className="diagram-gui__heading">{text.selectedTaskHeading}</h4>
        <p className="diagram-gui__hint">{text.itemGone}</p>
      </div>
    );
  }
  const idRestriction = describeRestriction(
    gui,
    shown.idRestriction,
    text.refusalReasons,
  );
  const deleteReason = describeRestriction(
    gui,
    shown.deleteRestriction,
    text.refusalReasons,
  );
  const linkRestriction = describeRestriction(
    gui,
    shown.addLinkRestriction === "noTaskId" ? "noTaskId" : null,
    text.refusalReasons,
  );
  const unavailable = busy || task === undefined;
  const chosen = moveTargets.find(
    (candidate) => String(candidate.sectionIndex) === destination,
  );
  const field = (
    label: string,
    committed: string,
    build: (target: GanttTaskView, value: string) => GanttOperation,
    refs: {
      input?: Ref<HTMLInputElement | HTMLTextAreaElement>;
      commit: MutableRefObject<GuiDraftCommit | null>;
    },
    extra: { hint?: string; restriction?: string | null } = {},
  ) => (
    <GuiDraftLabelField
      documentId={documentId}
      blockId={blockId}
      label={label}
      target={task}
      targetKey={taskKey}
      committed={committed}
      buildOperation={build}
      allowEmpty
      multiline={false}
      restrictionText={extra.restriction ?? null}
      hint={extra.hint}
      applyLabel={text.applyField(label)}
      revertLabel={text.revertField(label)}
      itemChangedText={text.itemChanged}
      busy={busy}
      runDraft={runDraft}
      onInvalidInput={onInvalidInput}
      inputRef={refs.input ?? null}
      commitPendingRef={refs.commit}
    />
  );
  return (
    <div className="diagram-gui__editor">
      <h4 className="diagram-gui__heading">{text.selectedTaskHeading}</h4>
      {task === undefined && (
        <p className="diagram-gui__hint">{text.itemGone}</p>
      )}
      {field(
        text.taskNameField,
        shown.name,
        (target, name): GanttOperation => ({
          kind: "renameTask",
          target: target.target,
          name,
        }),
        { input: nameInputRef, commit: nameCommitRef },
      )}
      {field(
        text.taskIdField,
        shown.id ?? "",
        (target, id): GanttOperation => ({
          kind: "setTaskId",
          target: target.target,
          id,
        }),
        { commit: idCommitRef },
        { restriction: idRestriction },
      )}
      {field(
        text.startField,
        shown.startText,
        (target, value): GanttOperation => ({
          kind: "setStart",
          target: target.target,
          start: ganttStartInputOf(value),
        }),
        { commit: startCommitRef },
        { hint: text.startHint(dateFormat) },
      )}
      {field(
        text.endField,
        shown.endText,
        (target, value): GanttOperation => ({
          kind: "setEnd",
          target: target.target,
          end: ganttEndInputOf(value),
        }),
        { commit: endCommitRef },
        { hint: text.endHint(dateFormat) },
      )}
      {field(
        text.linkField,
        shown.link,
        (target, value): GanttOperation =>
          value.trim() === ""
            ? { kind: "removeLink", target: target.target }
            : { kind: "addLink", target: target.target, url: value.trim() },
        { commit: linkCommitRef },
        {
          hint: text.linkHint,
          restriction:
            shown.addLinkRestriction === "noTaskId" ? linkRestriction : null,
        },
      )}
      <fieldset className="diagram-gui__checks">
        <legend className="diagram-gui__field-label">{text.tagsGroup}</legend>
        {GANTT_TAGS.map((tag) => (
          <GuiCheckbox
            key={tag}
            label={text.tags[tag]}
            checked={shown.tags.includes(tag)}
            disabled={unavailable}
            onChange={(checked) => {
              if (task === undefined) return;
              void runDraft({
                kind: "setStatusTags",
                target: task.target,
                tags: checked
                  ? [...task.tags, tag]
                  : task.tags.filter((other) => other !== tag),
              });
            }}
          />
        ))}
      </fieldset>
      <div className="diagram-gui__actions">
        <GanttActionButton
          label={text.moveTaskUp}
          restriction={task?.moveUp.restriction ?? null}
          unavailable={task === undefined}
          freezes={task?.moveUp.freezes}
          busy={busy}
          onPress={() => {
            if (task !== undefined) onMove(task, "up");
          }}
        />
        <GanttActionButton
          label={text.moveTaskDown}
          restriction={task?.moveDown.restriction ?? null}
          unavailable={task === undefined}
          freezes={task?.moveDown.freezes}
          busy={busy}
          onPress={() => {
            if (task !== undefined) onMove(task, "down");
          }}
        />
        <GanttActionButton
          label={text.duplicateTask}
          restriction={task?.duplicateRestriction ?? null}
          unavailable={task === undefined}
          busy={busy}
          onPress={() => {
            if (task !== undefined) onDuplicate(task);
          }}
        />
      </div>
      {moveTargets.length > 0 && (
        <>
          <GuiSelect
            label={text.moveToSectionField}
            value={destination}
            options={[
              { value: "", label: text.moveToSectionNone },
              ...moveTargets.map((candidate) => ({
                value: String(candidate.sectionIndex),
                label: candidate.name,
                disabled: candidate.restriction !== null,
              })),
            ]}
            onChange={setDestination}
            disabled={unavailable}
          />
          <div className="diagram-gui__actions">
            <GanttActionButton
              label={text.moveToSection}
              restriction={chosen?.restriction ?? null}
              unavailable={chosen === undefined || task === undefined}
              freezes={chosen?.freezes}
              busy={busy}
              onPress={() => {
                if (task !== undefined && chosen !== undefined) {
                  onMoveToSection(task, chosen.sectionIndex);
                }
              }}
            />
          </div>
        </>
      )}
      <div className="diagram-gui__actions">
        <GuiButton
          label={text.deleteTask}
          variant="danger"
          disabled={unavailable || deleteReason !== null}
          reasonId={hintId}
          onPress={() => {
            if (task !== undefined) onDelete(task);
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
