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
import type { GanttOperation } from "../../domain/diagram/gantt/gantt-operations";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { GuiButton, GuiSelect, GuiTextField } from "./gui-controls";
import { useGuiFieldDraft } from "./use-gui-field-draft";

export interface GanttAddSectionProps {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  // The selected section, when the new one may go right behind it.
  readonly afterSectionIndex: number | null;
  readonly busy: boolean;
  readonly runDraft: (
    operation: GanttOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  readonly nameInputRef: Ref<HTMLInputElement | HTMLTextAreaElement>;
  // Filled with "does the form hold input", so switching to Source can refuse while it does.
  readonly hasInputRef: MutableRefObject<(() => boolean) | null>;
}

const POSITION_END = "end";
const POSITION_AFTER = "after";

// Adds a section at the end of the chart or behind the selected section. Same rules as the
// other add forms: it adds only on Enter / the button (and an explicit save request), never
// when a field is left, and typed text is a pending draft that blocks switching to Source.
export function GanttAddSection({
  documentId,
  blockId,
  afterSectionIndex,
  busy,
  runDraft,
  nameInputRef,
  hasInputRef,
}: GanttAddSectionProps) {
  const text = useMessages().mermaid.gui.gantt;
  const [name, setNameState] = useState("");
  const [position, setPositionState] = useState(POSITION_END);
  const nameRef = useRef("");
  const positionRef = useRef(POSITION_END);
  const afterRef = useRef(afterSectionIndex);
  afterRef.current = afterSectionIndex;

  function setName(value: string): void {
    nameRef.current = value;
    setNameState(value);
  }
  function setPosition(value: string): void {
    positionRef.current = value;
    setPositionState(value);
  }

  const leaveUnchanged = async () => true;
  const hasPending = () => nameRef.current !== "";

  async function addPending(explicit: boolean): Promise<OperationResult<void>> {
    if (!explicit && !hasPending()) return operationOk(undefined);
    const after =
      positionRef.current === POSITION_AFTER ? afterRef.current : null;
    const result = await runDraft({
      kind: "addSection",
      name: nameRef.current,
      ...(after === null ? {} : { afterSectionIndex: after }),
    });
    if (!result.ok) return result;
    setName("");
    return operationOk(undefined);
  }

  const { commit } = useGuiFieldDraft({
    documentId,
    blockId,
    hasPending,
    inputKey: () => JSON.stringify([nameRef.current, positionRef.current]),
    commitAll: () => addPending(false),
    unappliedValues: () =>
      nameRef.current === ""
        ? []
        : [{ label: text.newSectionName, value: nameRef.current }],
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

  // "After the selected section" is only offered while a section is selected.
  const shownPosition =
    position === POSITION_AFTER && afterSectionIndex === null
      ? POSITION_END
      : position;
  return (
    <div className="diagram-gui__add">
      <h4 className="diagram-gui__heading">{text.addSectionHeading}</h4>
      <GuiTextField
        label={text.newSectionName}
        value={name}
        onChange={setName}
        onCommit={leaveUnchanged}
        onEnter={() => void add()}
        busy={busy}
        inputRef={nameInputRef}
      />
      <GuiSelect
        label={text.sectionPositionField}
        value={shownPosition}
        options={[
          { value: POSITION_END, label: text.positionEnd },
          ...(afterSectionIndex === null
            ? []
            : [{ value: POSITION_AFTER, label: text.positionAfterSelected }]),
        ]}
        disabled={busy}
        onChange={setPosition}
      />
      <div className="diagram-gui__actions">
        <GuiButton
          label={text.addSection}
          disabled={busy}
          onPress={() => void add()}
        />
      </div>
    </div>
  );
}
