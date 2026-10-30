import {
  type MutableRefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { ApplyDiagramEditsOutcome } from "../../application/diagram/apply-diagram-edits";
import {
  type OperationResult,
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import {
  SEQUENCE_NOTE_PLACEMENTS,
  type SequenceNotePlacement,
} from "../../domain/diagram/sequence/sequence-config";
import type { SequenceItemTarget } from "../../domain/diagram/sequence/sequence-operation-support";
import type { SequenceOperation } from "../../domain/diagram/sequence/sequence-operations";
import type { SequenceParticipantView } from "../../domain/diagram/sequence/sequence-view";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { GuiButton, GuiSelect, GuiTextField } from "./gui-controls";
import { oneLine } from "./sequence-entry-text";
import { useGuiFieldDraft } from "./use-gui-field-draft";

export interface SequenceAddNoteProps {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly participants: readonly SequenceParticipantView[];
  // The message or note selected in the list: a new note goes right behind it.
  readonly afterTarget: SequenceItemTarget | null;
  readonly busy: boolean;
  readonly runDraft: (
    operation: SequenceOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  readonly onInvalidInput: (message: string) => void;
  readonly hasInputRef: MutableRefObject<(() => boolean) | null>;
}

const NO_PARTICIPANT = "";
const DEFAULT_PLACEMENT: SequenceNotePlacement = "over";

// Adds a note next to one participant (or over two). It goes right behind the selected
// message or note, or at the end of the diagram when none is selected. Same rules as the
// other add forms.
export function SequenceAddNote({
  documentId,
  blockId,
  participants,
  afterTarget,
  busy,
  runDraft,
  onInvalidInput,
  hasInputRef,
}: SequenceAddNoteProps) {
  const text = useMessages().mermaid.gui.sequence;
  const hintId = useId();
  const [placement, setPlacementState] =
    useState<SequenceNotePlacement>(DEFAULT_PLACEMENT);
  const [first, setFirstState] = useState(NO_PARTICIPANT);
  const [second, setSecondState] = useState(NO_PARTICIPANT);
  const [note, setNoteState] = useState("");
  const placementRef = useRef<SequenceNotePlacement>(DEFAULT_PLACEMENT);
  const firstRef = useRef(NO_PARTICIPANT);
  const secondRef = useRef(NO_PARTICIPANT);
  const noteRef = useRef("");
  const afterRef = useRef(afterTarget);
  afterRef.current = afterTarget;

  const set =
    <T,>(ref: { current: T }, setState: (value: T) => void) =>
    (value: T) => {
      ref.current = value;
      setState(value);
    };
  const setPlacement = set(placementRef, setPlacementState);
  const setFirst = set(firstRef, setFirstState);
  const setSecond = set(secondRef, setSecondState);
  const setNote = set(noteRef, setNoteState);

  const leaveUnchanged = async () => true;
  const hasPending = () =>
    firstRef.current !== NO_PARTICIPANT ||
    secondRef.current !== NO_PARTICIPANT ||
    noteRef.current !== "";

  async function addPending(explicit: boolean): Promise<OperationResult<void>> {
    if (!explicit && !hasPending()) return operationOk(undefined);
    if (firstRef.current === NO_PARTICIPANT) {
      onInvalidInput(text.participantRequired);
      return operationErr(
        "invalidDiagramOperation",
        "participantRequired: the new note needs a participant",
      );
    }
    const chosen = [firstRef.current];
    if (
      placementRef.current === "over" &&
      secondRef.current !== NO_PARTICIPANT
    ) {
      chosen.push(secondRef.current);
    }
    const after = afterRef.current;
    const result = await runDraft({
      kind: "addNote",
      placement: placementRef.current,
      participants: chosen,
      text: noteRef.current,
      ...(after === null ? {} : { after }),
    });
    if (!result.ok) return result;
    setFirst(NO_PARTICIPANT);
    setSecond(NO_PARTICIPANT);
    setNote("");
    return operationOk(undefined);
  }

  const { commit } = useGuiFieldDraft({
    documentId,
    blockId,
    hasPending,
    inputKey: () =>
      JSON.stringify([
        placementRef.current,
        firstRef.current,
        secondRef.current,
        noteRef.current,
      ]),
    commitAll: () => addPending(false),
    unappliedValues: () => [
      ...(firstRef.current === NO_PARTICIPANT
        ? []
        : [{ label: text.noteFirstParticipant, value: firstRef.current }]),
      ...(secondRef.current === NO_PARTICIPANT
        ? []
        : [{ label: text.noteSecondParticipant, value: secondRef.current }]),
      ...(noteRef.current === ""
        ? []
        : [{ label: text.newNoteText, value: noteRef.current }]),
    ],
    onUnmount: "keep",
  });
  const add = async () => {
    await commit(() => addPending(true), "explicit");
  };
  useEffect(() => {
    hasInputRef.current = hasPending;
    return () => {
      hasInputRef.current = null;
    };
  });

  const options = (empty: string) => [
    { value: NO_PARTICIPANT, label: empty },
    ...participants.map((participant) => ({
      value: participant.id,
      label: `${oneLine(participant.displayLabel)} (${participant.id})`,
    })),
  ];
  const noParticipants = participants.length === 0;
  return (
    <div className="diagram-gui__add">
      <h4 className="diagram-gui__heading">{text.addNoteHeading}</h4>
      <GuiSelect
        label={text.newNotePlacement}
        value={placement}
        options={SEQUENCE_NOTE_PLACEMENTS.map((name) => ({
          value: name,
          label: text.placements[name],
        }))}
        disabled={busy}
        onChange={(value) => {
          const picked = SEQUENCE_NOTE_PLACEMENTS.find(
            (name) => name === value,
          );
          if (picked !== undefined) setPlacement(picked);
        }}
      />
      <GuiSelect
        label={text.noteFirstParticipant}
        value={first}
        options={options(text.choose)}
        disabled={busy || noParticipants}
        reasonId={hintId}
        onChange={setFirst}
      />
      {placement === "over" && (
        <GuiSelect
          label={text.noteSecondParticipant}
          value={second}
          options={options(text.none)}
          disabled={busy || noParticipants}
          reasonId={hintId}
          onChange={setSecond}
        />
      )}
      <GuiTextField
        label={text.newNoteText}
        value={note}
        onChange={setNote}
        onCommit={leaveUnchanged}
        onEnter={() => void add()}
        busy={busy}
        multiline
      />
      <div className="diagram-gui__actions">
        <GuiButton
          label={text.addNote}
          disabled={busy || noParticipants}
          reasonId={hintId}
          onPress={() => void add()}
        />
      </div>
      {noParticipants && (
        <p id={hintId} className="diagram-gui__hint">
          {text.noParticipants}
        </p>
      )}
    </div>
  );
}
