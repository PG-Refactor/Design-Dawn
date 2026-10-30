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
  ganttEndInputOf,
  ganttStartInputOf,
} from "../../domain/diagram/gantt/gantt-input";
import type { GanttOperation } from "../../domain/diagram/gantt/gantt-operations";
import type { GanttSectionView } from "../../domain/diagram/gantt/gantt-view";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { GuiButton, GuiSelect, GuiTextField } from "./gui-controls";
import { useGuiFieldDraft } from "./use-gui-field-draft";

export interface GanttAddTaskProps {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly sections: readonly GanttSectionView[];
  readonly dateFormat: string;
  readonly busy: boolean;
  readonly runDraft: (
    operation: GanttOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  readonly onInvalidInput: (message: string) => void;
  readonly hasInputRef: MutableRefObject<(() => boolean) | null>;
}

const SECTION_END = "end";

// Adds a task to the end of a section (or of the chart). The name, the start and the end are
// required; the id is generated when left empty, and status words are set afterwards on the
// task itself. Same rules as the other add forms.
export function GanttAddTask({
  documentId,
  blockId,
  sections,
  dateFormat,
  busy,
  runDraft,
  onInvalidInput,
  hasInputRef,
}: GanttAddTaskProps) {
  const text = useMessages().mermaid.gui.gantt;
  const startHintId = useId();
  const endHintId = useId();
  const [section, setSectionState] = useState(SECTION_END);
  const [name, setNameState] = useState("");
  const [id, setIdState] = useState("");
  const [start, setStartState] = useState("");
  const [end, setEndState] = useState("");
  const sectionRef = useRef(SECTION_END);
  const nameRef = useRef("");
  const idRef = useRef("");
  const startRef = useRef("");
  const endRef = useRef("");

  const set =
    (ref: { current: string }, setState: (value: string) => void) =>
    (value: string) => {
      ref.current = value;
      setState(value);
    };
  const setSection = set(sectionRef, setSectionState);
  const setName = set(nameRef, setNameState);
  const setId = set(idRef, setIdState);
  const setStart = set(startRef, setStartState);
  const setEnd = set(endRef, setEndState);

  const leaveUnchanged = async () => true;
  const hasPending = () =>
    nameRef.current !== "" ||
    idRef.current !== "" ||
    startRef.current !== "" ||
    endRef.current !== "";

  async function addPending(explicit: boolean): Promise<OperationResult<void>> {
    if (!explicit && !hasPending()) return operationOk(undefined);
    const missing =
      nameRef.current.trim() === ""
        ? { code: "nameRequired", message: text.nameRequired }
        : startRef.current.trim() === ""
          ? { code: "startRequired", message: text.startRequired }
          : endRef.current.trim() === ""
            ? { code: "endRequired", message: text.endRequired }
            : null;
    if (missing !== null) {
      onInvalidInput(missing.message);
      return operationErr(
        "invalidDiagramOperation",
        `${missing.code}: the new task needs a name, a start and an end`,
      );
    }
    const typedId = idRef.current.trim();
    const sectionIndex = sections.findIndex(
      (candidate) => String(candidate.target.index) === sectionRef.current,
    );
    const result = await runDraft({
      kind: "addTask",
      name: nameRef.current,
      start: ganttStartInputOf(startRef.current),
      end: ganttEndInputOf(endRef.current),
      ...(typedId === "" ? {} : { id: typedId }),
      ...(sectionIndex < 0 ? {} : { sectionIndex }),
    });
    if (!result.ok) return result;
    setName("");
    setId("");
    setStart("");
    setEnd("");
    return operationOk(undefined);
  }

  const { commit } = useGuiFieldDraft({
    documentId,
    blockId,
    hasPending,
    inputKey: () =>
      JSON.stringify([
        sectionRef.current,
        nameRef.current,
        idRef.current,
        startRef.current,
        endRef.current,
      ]),
    commitAll: () => addPending(false),
    unappliedValues: () =>
      [
        { label: text.newTaskName, value: nameRef.current },
        { label: text.newTaskId, value: idRef.current },
        { label: text.newTaskStart, value: startRef.current },
        { label: text.newTaskEnd, value: endRef.current },
      ].filter((entry) => entry.value !== ""),
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

  const known =
    section === SECTION_END ||
    sections.some((candidate) => String(candidate.target.index) === section);
  return (
    <div className="diagram-gui__add">
      <h4 className="diagram-gui__heading">{text.addTaskHeading}</h4>
      <GuiSelect
        label={text.newTaskSection}
        value={known ? section : SECTION_END}
        options={[
          { value: SECTION_END, label: text.newTaskSectionEnd },
          ...sections.map((candidate) => ({
            value: String(candidate.target.index),
            label: candidate.target.name,
          })),
        ]}
        disabled={busy}
        onChange={setSection}
      />
      <GuiTextField
        label={text.newTaskName}
        value={name}
        onChange={setName}
        onCommit={leaveUnchanged}
        onEnter={() => void add()}
        busy={busy}
      />
      <GuiTextField
        label={text.newTaskId}
        value={id}
        onChange={setId}
        onCommit={leaveUnchanged}
        onEnter={() => void add()}
        busy={busy}
      />
      <GuiTextField
        label={text.newTaskStart}
        value={start}
        onChange={setStart}
        onCommit={leaveUnchanged}
        onEnter={() => void add()}
        busy={busy}
        describedBy={startHintId}
      />
      <p id={startHintId} className="diagram-gui__hint">
        {text.addStartHint(dateFormat)}
      </p>
      <GuiTextField
        label={text.newTaskEnd}
        value={end}
        onChange={setEnd}
        onCommit={leaveUnchanged}
        onEnter={() => void add()}
        busy={busy}
        describedBy={endHintId}
      />
      <p id={endHintId} className="diagram-gui__hint">
        {text.endHint(dateFormat)}
      </p>
      <div className="diagram-gui__actions">
        <GuiButton
          label={text.addTask}
          disabled={busy}
          onPress={() => void add()}
        />
      </div>
    </div>
  );
}
