import {
  type MutableRefObject,
  type Ref,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ApplyDiagramEditsOutcome } from "../../application/diagram/apply-diagram-edits";
import {
  type OperationResult,
  operationOk,
} from "../../application/ports/operation-error";
import {
  SEQUENCE_PARTICIPANT_KINDS,
  type SequenceParticipantKind,
} from "../../domain/diagram/sequence/sequence-config";
import type { SequenceOperation } from "../../domain/diagram/sequence/sequence-operations";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { GuiButton, GuiSelect, GuiTextField } from "./gui-controls";
import { useGuiFieldDraft } from "./use-gui-field-draft";

export interface SequenceAddParticipantProps {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly busy: boolean;
  readonly runDraft: (
    operation: SequenceOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  // Called with the id the participant was given (typed, or made up by the domain: null).
  readonly onAdded: (participantId: string | null) => void;
  readonly labelInputRef: Ref<HTMLInputElement | HTMLTextAreaElement>;
  // Filled with "does the form hold input", so switching to Source can refuse while it does.
  readonly hasInputRef: MutableRefObject<(() => boolean) | null>;
}

const DEFAULT_KIND: SequenceParticipantKind = "participant";

// Adds a participant from a label, an optional id and a kind. Same rules as the other add
// forms: it adds only on Enter / the button (and an explicit save request), never when a
// field is left, and its input is a pending draft that blocks switching to Source. An empty
// form adds a participant with a made-up id and no alias.
export function SequenceAddParticipant({
  documentId,
  blockId,
  busy,
  runDraft,
  onAdded,
  labelInputRef,
  hasInputRef,
}: SequenceAddParticipantProps) {
  const text = useMessages().mermaid.gui.sequence;
  const [label, setLabelState] = useState("");
  const [id, setIdState] = useState("");
  const [kind, setKind] = useState<SequenceParticipantKind>(DEFAULT_KIND);
  const labelRef = useRef("");
  const idRef = useRef("");
  const kindRef = useRef<SequenceParticipantKind>(DEFAULT_KIND);

  function setLabel(value: string): void {
    labelRef.current = value;
    setLabelState(value);
  }
  function setId(value: string): void {
    idRef.current = value;
    setIdState(value);
  }

  const leaveUnchanged = async () => true;
  const hasPending = () => labelRef.current !== "" || idRef.current !== "";

  async function addPending(explicit: boolean): Promise<OperationResult<void>> {
    if (!explicit && !hasPending()) return operationOk(undefined);
    const typedId = idRef.current.trim();
    const result = await runDraft({
      kind: "addParticipant",
      participantKind: kindRef.current,
      label: labelRef.current,
      ...(typedId === "" ? {} : { id: typedId }),
    });
    if (!result.ok) return result;
    setLabel("");
    setId("");
    onAdded(typedId === "" ? null : typedId);
    return operationOk(undefined);
  }

  const { commit } = useGuiFieldDraft({
    documentId,
    blockId,
    hasPending,
    inputKey: () => JSON.stringify([labelRef.current, idRef.current]),
    commitAll: () => addPending(false),
    unappliedValues: () => [
      ...(labelRef.current === ""
        ? []
        : [{ label: text.newParticipantLabel, value: labelRef.current }]),
      ...(idRef.current === ""
        ? []
        : [{ label: text.newParticipantId, value: idRef.current }]),
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

  return (
    <div className="diagram-gui__add">
      <h4 className="diagram-gui__heading">{text.addParticipantHeading}</h4>
      <GuiTextField
        label={text.newParticipantLabel}
        value={label}
        onChange={setLabel}
        onCommit={leaveUnchanged}
        onEnter={() => void add()}
        busy={busy}
        inputRef={labelInputRef}
      />
      <GuiTextField
        label={text.newParticipantId}
        value={id}
        onChange={setId}
        onCommit={leaveUnchanged}
        onEnter={() => void add()}
        busy={busy}
      />
      <GuiSelect
        label={text.newParticipantKind}
        value={kind}
        options={SEQUENCE_PARTICIPANT_KINDS.map((name) => ({
          value: name,
          label: text.kinds[name],
        }))}
        disabled={busy}
        onChange={(value) => {
          const picked = SEQUENCE_PARTICIPANT_KINDS.find(
            (name) => name === value,
          );
          if (picked === undefined) return;
          kindRef.current = picked;
          setKind(picked);
        }}
      />
      <div className="diagram-gui__actions">
        <GuiButton
          label={text.addParticipant}
          disabled={busy}
          onPress={() => void add()}
        />
      </div>
    </div>
  );
}
