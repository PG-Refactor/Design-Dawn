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
  SEQUENCE_ARROWS,
  type SequenceArrow,
} from "../../domain/diagram/sequence/sequence-config";
import { SEQUENCE_DEFAULT_ARROW } from "../../domain/diagram/sequence/sequence-operation-config";
import type { SequenceItemTarget } from "../../domain/diagram/sequence/sequence-operation-support";
import type { SequenceOperation } from "../../domain/diagram/sequence/sequence-operations";
import type { SequenceParticipantView } from "../../domain/diagram/sequence/sequence-view";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { GuiButton, GuiSelect, GuiTextField } from "./gui-controls";
import { oneLine } from "./sequence-entry-text";
import { useGuiFieldDraft } from "./use-gui-field-draft";

export interface SequenceAddMessageProps {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly participants: readonly SequenceParticipantView[];
  // The message or note selected in the list, when the new message may go right behind it.
  readonly afterTarget: SequenceItemTarget | null;
  readonly busy: boolean;
  readonly runDraft: (
    operation: SequenceOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  readonly onInvalidInput: (message: string) => void;
  readonly hasInputRef: MutableRefObject<(() => boolean) | null>;
}

const NO_PARTICIPANT = "";
const POSITION_END = "end";
const POSITION_AFTER = "after";

// Adds a message between two existing participants, at the end of the diagram or right
// behind the selected entry. Same rules as the other add forms: Enter / the button (and an
// explicit save request) add; a chosen participant or typed text is a pending draft; nothing
// is added by leaving a field.
export function SequenceAddMessage({
  documentId,
  blockId,
  participants,
  afterTarget,
  busy,
  runDraft,
  onInvalidInput,
  hasInputRef,
}: SequenceAddMessageProps) {
  const text = useMessages().mermaid.gui.sequence;
  const hintId = useId();
  const [from, setFromState] = useState(NO_PARTICIPANT);
  const [to, setToState] = useState(NO_PARTICIPANT);
  const [arrow, setArrowState] = useState<SequenceArrow>(
    SEQUENCE_DEFAULT_ARROW,
  );
  const [message, setMessageState] = useState("");
  const [position, setPositionState] = useState(POSITION_END);
  const fromRef = useRef(NO_PARTICIPANT);
  const toRef = useRef(NO_PARTICIPANT);
  const arrowRef = useRef<SequenceArrow>(SEQUENCE_DEFAULT_ARROW);
  const messageRef = useRef("");
  const positionRef = useRef(POSITION_END);
  const afterRef = useRef(afterTarget);
  afterRef.current = afterTarget;

  const set =
    <T,>(ref: { current: T }, setState: (value: T) => void) =>
    (value: T) => {
      ref.current = value;
      setState(value);
    };
  const setFrom = set(fromRef, setFromState);
  const setTo = set(toRef, setToState);
  const setArrow = set(arrowRef, setArrowState);
  const setMessage = set(messageRef, setMessageState);
  const setPosition = set(positionRef, setPositionState);

  const leaveUnchanged = async () => true;
  const hasPending = () =>
    fromRef.current !== NO_PARTICIPANT ||
    toRef.current !== NO_PARTICIPANT ||
    messageRef.current !== "";

  async function addPending(explicit: boolean): Promise<OperationResult<void>> {
    if (!explicit && !hasPending()) return operationOk(undefined);
    if (
      fromRef.current === NO_PARTICIPANT ||
      toRef.current === NO_PARTICIPANT
    ) {
      onInvalidInput(text.endpointsRequired);
      return operationErr(
        "invalidDiagramOperation",
        "endpointsRequired: the new message needs a sender and a receiver",
      );
    }
    const after =
      positionRef.current === POSITION_AFTER ? afterRef.current : null;
    const result = await runDraft({
      kind: "addMessage",
      from: fromRef.current,
      to: toRef.current,
      arrow: arrowRef.current,
      text: messageRef.current,
      ...(after === null ? {} : { after }),
    });
    if (!result.ok) return result;
    setFrom(NO_PARTICIPANT);
    setTo(NO_PARTICIPANT);
    setMessage("");
    return operationOk(undefined);
  }

  const { commit } = useGuiFieldDraft({
    documentId,
    blockId,
    hasPending,
    inputKey: () =>
      JSON.stringify([
        fromRef.current,
        toRef.current,
        messageRef.current,
        positionRef.current,
      ]),
    commitAll: () => addPending(false),
    unappliedValues: () => [
      ...(fromRef.current === NO_PARTICIPANT
        ? []
        : [{ label: text.fromField, value: fromRef.current }]),
      ...(toRef.current === NO_PARTICIPANT
        ? []
        : [{ label: text.toField, value: toRef.current }]),
      ...(messageRef.current === ""
        ? []
        : [{ label: text.newMessageText, value: messageRef.current }]),
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

  const options = [
    { value: NO_PARTICIPANT, label: text.choose },
    ...participants.map((participant) => ({
      value: participant.id,
      label: `${oneLine(participant.displayLabel)} (${participant.id})`,
    })),
  ];
  const noParticipants = participants.length === 0;
  // "After the selected entry" is only offered while a message or note is selected.
  const shownPosition =
    position === POSITION_AFTER && afterTarget === null
      ? POSITION_END
      : position;
  return (
    <div className="diagram-gui__add">
      <h4 className="diagram-gui__heading">{text.addMessageHeading}</h4>
      <GuiSelect
        label={text.fromField}
        value={from}
        options={options}
        disabled={busy || noParticipants}
        reasonId={hintId}
        onChange={setFrom}
      />
      <GuiSelect
        label={text.toField}
        value={to}
        options={options}
        disabled={busy || noParticipants}
        reasonId={hintId}
        onChange={setTo}
      />
      <GuiSelect
        label={text.newMessageArrow}
        value={arrow}
        options={SEQUENCE_ARROWS.map((name) => ({
          value: name,
          label: text.arrows[name],
        }))}
        disabled={busy}
        onChange={(value) => {
          const picked = SEQUENCE_ARROWS.find((name) => name === value);
          if (picked !== undefined) setArrow(picked);
        }}
      />
      <GuiTextField
        label={text.newMessageText}
        value={message}
        onChange={setMessage}
        onCommit={leaveUnchanged}
        onEnter={() => void add()}
        busy={busy}
        multiline
      />
      <GuiSelect
        label={text.positionField}
        value={shownPosition}
        options={[
          { value: POSITION_END, label: text.positionEnd },
          ...(afterTarget === null
            ? []
            : [{ value: POSITION_AFTER, label: text.positionAfterSelected }]),
        ]}
        disabled={busy}
        onChange={setPosition}
      />
      <div className="diagram-gui__actions">
        <GuiButton
          label={text.addMessage}
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
