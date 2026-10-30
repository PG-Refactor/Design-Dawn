import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type OperationResult,
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import type { SequenceOperation } from "../../domain/diagram/sequence/sequence-operations";
import {
  readSequenceView,
  type SequenceEntryView,
} from "../../domain/diagram/sequence/sequence-view";
import { useMessages } from "../workspace/use-messages";
import { describeRefusal, describeRestriction } from "./diagram-gui-text";
import { GuiSelect } from "./gui-controls";
import { GuiDraftLabelField } from "./gui-draft-label-field";
import { SequenceAddMessage } from "./sequence-add-message";
import { SequenceAddNote } from "./sequence-add-note";
import { SequenceAddParticipant } from "./sequence-add-participant";
import { SequenceBlockTools } from "./sequence-block-tools";
import { SequenceEntryEditor } from "./sequence-entry-editor";
import { SequenceEntryList } from "./sequence-entry-list";
import { entryKey } from "./sequence-entry-text";
import { SequenceParticipantEditor } from "./sequence-participant-editor";
import { SequenceParticipantList } from "./sequence-participant-list";
import {
  type DiagramOperationOutcome,
  type DiagramOperationTarget,
  useDiagramOperation,
} from "./use-diagram-operation";
import type { GuiDraftCommit } from "./use-gui-field-draft";

export interface SequenceGuiPanelProps {
  readonly target: DiagramOperationTarget;
  readonly shortId: string;
  // The block's committed text. The view is derived from it on every render.
  readonly source: string;
  // Filled with "get ready to show Source": commits what is pending in the text field and
  // refuses while an add form holds input. See `leaveGui`.
  readonly leaveRef: MutableRefObject<GuiDraftCommit | null>;
}

// Which element is selected: a participant by id, an entry by its position and what it holds.
// Component state, separate from the canvas's block selection.
type SequenceSelection =
  | { readonly kind: "participant"; readonly id: string }
  | {
      readonly kind: "entry";
      readonly index: number;
      readonly fingerprint: string;
      readonly entryKind: SequenceEntryView["kind"];
    };

// The title field edits one thing, so its target is this constant.
const TITLE_TARGET = { key: "title" } as const;
const AUTONUMBER_ON = "on";
const AUTONUMBER_OFF = "off";

export function SequenceGuiPanel({
  target,
  shortId,
  source,
  leaveRef,
}: SequenceGuiPanelProps) {
  const gui = useMessages().mermaid.gui;
  const text = gui.sequence;
  const view = useMemo(() => readSequenceView(source), [source]);
  const operation = useDiagramOperation(target);
  const { busy } = operation;
  const [selection, setSelection] = useState<SequenceSelection | null>(null);
  // Counts the user's picks; the editor restarts its draft when it changes.
  const [selectionKey, setSelectionKey] = useState(0);
  const [inputError, setInputError] = useState<string | null>(null);
  const participantListRef = useRef<HTMLDivElement>(null);
  const entryListRef = useRef<HTMLDivElement>(null);
  const editorLabelRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const addParticipantLabelRef = useRef<HTMLInputElement | HTMLTextAreaElement>(
    null,
  );
  const titleLabelRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const commitPendingRef = useRef<GuiDraftCommit | null>(null);
  const titleCommitRef = useRef<GuiDraftCommit | null>(null);
  const addParticipantInputRef = useRef<(() => boolean) | null>(null);
  const addMessageInputRef = useRef<(() => boolean) | null>(null);
  const addNoteInputRef = useRef<(() => boolean) | null>(null);
  const blockToolsInputRef = useRef<(() => boolean) | null>(null);
  // True from the moment this panel sends an operation until the view has followed it: only
  // then may a selected entry that no longer matches be looked up by its position (an edit
  // changes what the entry holds). An undo, a redo or a Source edit never gets that
  // latitude, so the selection cannot quietly move to another entry.
  const followEditRef = useRef(false);
  const { documentId, blockId } = target;

  // The selection is resolved against the committed text each time, so an undo, a redo or
  // an edit made in Source can never leave it pointing at a different element.
  const selectedParticipant =
    selection?.kind === "participant"
      ? view?.participants.find(
          (participant) => participant.id === selection.id,
        )
      : undefined;
  const selectedEntry = useMemo((): SequenceEntryView | undefined => {
    if (selection?.kind !== "entry" || view === null) return undefined;
    const exact = view.entries.find(
      (entry) =>
        entry.target.index === selection.index &&
        entry.target.fingerprint === selection.fingerprint,
    );
    if (exact !== undefined) return exact;
    if (!followEditRef.current) return undefined;
    // A move shifts the entry by a position: follow the nearest one that holds the same.
    const same = view.entries.filter(
      (entry) => entry.target.fingerprint === selection.fingerprint,
    );
    const nearest = same.reduce<SequenceEntryView | undefined>(
      (best, entry) =>
        best === undefined ||
        Math.abs(entry.target.index - selection.index) <
          Math.abs(best.target.index - selection.index)
          ? entry
          : best,
      undefined,
    );
    if (nearest !== undefined) return nearest;
    // An edit changed what the entry holds: it is still at its position.
    const atPosition = view.entries.find(
      (entry) => entry.target.index === selection.index,
    );
    return atPosition?.kind === selection.entryKind ? atPosition : undefined;
  }, [selection, view]);

  // Once the view has followed an edit, the selection is anchored to the entry as it is now.
  useEffect(() => {
    if (selection?.kind !== "entry" || selectedEntry === undefined) return;
    if (
      selectedEntry.target.index !== selection.index ||
      selectedEntry.target.fingerprint !== selection.fingerprint
    ) {
      setSelection({
        kind: "entry",
        index: selectedEntry.target.index,
        fingerprint: selectedEntry.target.fingerprint,
        entryKind: selectedEntry.kind,
      });
    }
    followEditRef.current = false;
  }, [selection, selectedEntry]);

  const run = useCallback(
    async (
      sequenceOperation: SequenceOperation,
    ): Promise<DiagramOperationOutcome> => {
      setInputError(null);
      followEditRef.current = true;
      const outcome = await operation.apply({
        diagram: "sequence",
        operation: sequenceOperation,
      });
      if (outcome !== "applied") followEditRef.current = false;
      return outcome;
    },
    [operation],
  );
  const runDraft = useCallback(
    async (sequenceOperation: SequenceOperation) => {
      setInputError(null);
      followEditRef.current = true;
      const result = await operation.applyDraft({
        diagram: "sequence",
        operation: sequenceOperation,
      });
      if (!result.ok) followEditRef.current = false;
      return result;
    },
    [operation],
  );

  async function commitPending(): Promise<OperationResult<void>> {
    const committed = await commitPendingRef.current?.();
    if (committed !== undefined && !committed.ok) return committed;
    return operationOk(undefined);
  }

  async function select(next: SequenceSelection): Promise<void> {
    const committed = await commitPending();
    if (!committed.ok) return;
    setInputError(null);
    operation.clearRefusal();
    followEditRef.current = false;
    setSelectionKey((key) => key + 1);
    setSelection(next);
  }

  // GUI -> Source. Pending text is committed (a refusal keeps it, and the switch). The add
  // forms are NOT committed: a view switch is not a request to add, so input there blocks
  // the switch with a message and stays.
  async function leaveGui(): Promise<OperationResult<void>> {
    if (
      addParticipantInputRef.current?.() === true ||
      addMessageInputRef.current?.() === true ||
      addNoteInputRef.current?.() === true ||
      blockToolsInputRef.current?.() === true
    ) {
      setInputError(gui.addInputPending);
      return operationErr(
        "invalidDiagramOperation",
        "addInputPending: an add form has input",
      );
    }
    const pending = await commitPending();
    if (!pending.ok) return pending;
    const title = await titleCommitRef.current?.();
    if (title !== undefined && !title.ok) return title;
    return operationOk(undefined);
  }
  useEffect(() => {
    leaveRef.current = leaveGui;
    return () => {
      leaveRef.current = null;
    };
  });

  // For an operation after which the selected element is gone (a delete, an unwrap).
  async function removeSelected(
    sequenceOperation: SequenceOperation,
  ): Promise<void> {
    // The button disappears with the selection; the focus moves first, because an element
    // that is removed while focused would look like leaving the editor.
    (entryListRef.current ?? addParticipantLabelRef.current)?.focus();
    const outcome = await run(sequenceOperation);
    if (outcome !== "applied") return;
    setSelectionKey((key) => key + 1);
    setSelection(null);
  }

  if (view === null) return null;
  const refusal =
    operation.refusal === null ? null : describeRefusal(gui, operation.refusal);
  // A new message or note may go right behind the selected message or note.
  const afterTarget =
    selectedEntry?.kind === "message" || selectedEntry?.kind === "note"
      ? selectedEntry.target
      : null;
  const titleRestriction = describeRestriction(gui, view.titleRestriction);

  return (
    <div className="diagram-gui__sequence">
      {busy && (
        <p role="status" className="diagram-gui__busy">
          {gui.busy}
        </p>
      )}
      {(refusal !== null || inputError !== null) && (
        <div role="alert" className="diagram-gui__refusal">
          <p className="diagram-gui__refusal-heading">{gui.refusalHeading}</p>
          <p>{inputError ?? refusal?.message}</p>
          {inputError === null && refusal?.mermaidMessage != null && (
            <>
              <p className="diagram-gui__refusal-label">
                {gui.refusalDetailLabel}
              </p>
              <pre className="diagram-gui__refusal-detail">
                {refusal.mermaidMessage}
              </pre>
            </>
          )}
        </div>
      )}
      <GuiDraftLabelField
        documentId={documentId}
        blockId={blockId}
        label={text.titleField}
        target={TITLE_TARGET}
        targetKey={(titleTarget) => titleTarget.key}
        committed={view.title}
        buildOperation={(_titleTarget, title): SequenceOperation => ({
          kind: "setTitle",
          title,
        })}
        allowEmpty
        multiline={false}
        restrictionText={titleRestriction}
        itemChangedText={text.itemChanged}
        busy={busy}
        runDraft={runDraft}
        onInvalidInput={setInputError}
        inputRef={titleLabelRef}
        commitPendingRef={titleCommitRef}
      />
      <GuiSelect
        label={text.autonumberLabel}
        value={
          view.autonumber.state === "on"
            ? AUTONUMBER_ON
            : view.autonumber.state === "off"
              ? AUTONUMBER_OFF
              : view.autonumber.state
        }
        options={[
          { value: AUTONUMBER_OFF, label: text.autonumberStates.off },
          { value: AUTONUMBER_ON, label: text.autonumberStates.on },
          ...(view.autonumber.state === "custom"
            ? [{ value: "custom", label: text.autonumberStates.custom }]
            : []),
        ]}
        disabled={busy || view.autonumber.state === "custom"}
        onChange={(value) => {
          if (value === AUTONUMBER_ON || value === AUTONUMBER_OFF) {
            void run({
              kind: "setAutonumber",
              enabled: value === AUTONUMBER_ON,
            });
          }
        }}
      />
      {view.autonumber.state === "custom" && (
        <p className="diagram-gui__hint">{text.autonumberCustom}</p>
      )}
      <h4 className="diagram-gui__heading">{text.participantsHeading}</h4>
      <SequenceParticipantList
        shortId={shortId}
        participants={view.participants}
        selectedId={
          selection?.kind === "participant"
            ? (selectedParticipant?.id ?? null)
            : null
        }
        onSelect={(id) => void select({ kind: "participant", id })}
        onEnter={() => editorLabelRef.current?.focus()}
        listRef={participantListRef}
      />
      <h4 className="diagram-gui__heading">{text.entriesHeading}</h4>
      <SequenceEntryList
        shortId={shortId}
        entries={view.entries}
        selectedKey={
          selection?.kind === "entry" && selectedEntry !== undefined
            ? entryKey(selectedEntry)
            : null
        }
        onSelect={(key) => {
          const entry = view.entries.find(
            (candidate) => entryKey(candidate) === key,
          );
          if (entry !== undefined) {
            void select({
              kind: "entry",
              index: entry.target.index,
              fingerprint: entry.target.fingerprint,
              entryKind: entry.kind,
            });
          }
        }}
        onEnter={() => editorLabelRef.current?.focus()}
        listRef={entryListRef}
      />
      {selection === null &&
        (view.participants.length > 0 || view.entries.length > 0) && (
          <p className="diagram-gui__hint">{text.noSelection}</p>
        )}
      {selection?.kind === "participant" && (
        <SequenceParticipantEditor
          key={selectionKey}
          documentId={documentId}
          blockId={blockId}
          participant={selectedParticipant}
          busy={busy}
          runDraft={runDraft}
          run={run}
          onRemove={(sequenceOperation) =>
            void removeSelected(sequenceOperation)
          }
          onInvalidInput={setInputError}
          labelInputRef={editorLabelRef}
          commitPendingRef={commitPendingRef}
        />
      )}
      {selection?.kind === "entry" && (
        <SequenceEntryEditor
          key={selectionKey}
          documentId={documentId}
          blockId={blockId}
          entry={selectedEntry}
          busy={busy}
          run={run}
          runDraft={runDraft}
          onInvalidInput={setInputError}
          onRemove={(sequenceOperation) =>
            void removeSelected(sequenceOperation)
          }
          labelInputRef={editorLabelRef}
          commitPendingRef={commitPendingRef}
        />
      )}
      <SequenceBlockTools
        documentId={documentId}
        blockId={blockId}
        entries={view.entries}
        selected={selection?.kind === "entry" ? selectedEntry : undefined}
        busy={busy}
        runDraft={runDraft}
        onInvalidInput={setInputError}
        hasInputRef={blockToolsInputRef}
      />
      <SequenceAddParticipant
        documentId={documentId}
        blockId={blockId}
        busy={busy}
        runDraft={runDraft}
        onAdded={(participantId) => {
          if (participantId === null) return;
          setSelectionKey((key) => key + 1);
          setSelection({ kind: "participant", id: participantId });
        }}
        labelInputRef={addParticipantLabelRef}
        hasInputRef={addParticipantInputRef}
      />
      <SequenceAddMessage
        documentId={documentId}
        blockId={blockId}
        participants={view.participants}
        afterTarget={afterTarget}
        busy={busy}
        runDraft={runDraft}
        onInvalidInput={setInputError}
        hasInputRef={addMessageInputRef}
      />
      <SequenceAddNote
        documentId={documentId}
        blockId={blockId}
        participants={view.participants}
        afterTarget={afterTarget}
        busy={busy}
        runDraft={runDraft}
        onInvalidInput={setInputError}
        hasInputRef={addNoteInputRef}
      />
    </div>
  );
}
