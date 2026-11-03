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
import type { FlowchartOperation } from "../../domain/diagram/flowchart/flowchart-operations";
import type { FlowchartNodeView } from "../../domain/diagram/flowchart/flowchart-view";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { oneLine } from "./flowchart-node-list";
import { GuiButton, GuiSelect, GuiTextField } from "./gui-controls";
import { useGuiFieldDraft } from "./use-gui-field-draft";

export interface FlowchartAddEdgeProps {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly nodes: readonly FlowchartNodeView[];
  readonly busy: boolean;
  readonly runDraft: (
    operation: FlowchartOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  readonly onInvalidInput: (message: string) => void;
  readonly onAdded: () => void;
  readonly hasInputRef: MutableRefObject<(() => boolean) | null>;
  // Chosen elsewhere (the node right-clicked in the diagram): becomes the start node. A
  // new `serial` applies it again, also for the same node.
  readonly startPreset?: {
    readonly nodeId: string;
    readonly serial: number;
  } | null;
}

// The empty choice of a select that has not been used yet.
const NO_NODE = "";

// Adds an edge between two existing nodes with the default arrow and an optional label.
// Same rules as the other add form: Enter / the button (and an explicit save request) add;
// any chosen node or typed label is a pending draft; nothing is added by leaving a field.
export function FlowchartAddEdge({
  documentId,
  blockId,
  nodes,
  busy,
  runDraft,
  onInvalidInput,
  onAdded,
  hasInputRef,
  startPreset = null,
}: FlowchartAddEdgeProps) {
  const gui = useMessages().mermaid.gui;
  const text = gui.flowchart;
  const hintId = useId();
  const [start, setStartState] = useState(NO_NODE);
  const [end, setEndState] = useState(NO_NODE);
  const [label, setLabelState] = useState("");
  const startRef = useRef(NO_NODE);
  const endRef = useRef(NO_NODE);
  const labelRef = useRef("");

  function setStart(value: string): void {
    startRef.current = value;
    setStartState(value);
  }
  function setEnd(value: string): void {
    endRef.current = value;
    setEndState(value);
  }
  function setLabel(value: string): void {
    labelRef.current = value;
    setLabelState(value);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: applied once per preset (its serial), not on every render.
  useEffect(() => {
    if (startPreset !== null) setStart(startPreset.nodeId);
  }, [startPreset?.serial]);

  const leaveUnchanged = async () => true;
  const hasPending = () =>
    startRef.current !== NO_NODE ||
    endRef.current !== NO_NODE ||
    labelRef.current !== "";

  async function addPending(explicit: boolean): Promise<OperationResult<void>> {
    if (!explicit && !hasPending()) return operationOk(undefined);
    if (startRef.current === NO_NODE || endRef.current === NO_NODE) {
      onInvalidInput(text.endpointsRequired);
      return operationErr(
        "invalidDiagramOperation",
        "endpointsRequired: the new edge needs a start and an end",
      );
    }
    const result = await runDraft({
      kind: "addEdge",
      from: startRef.current,
      to: endRef.current,
      ...(labelRef.current === "" ? {} : { label: labelRef.current }),
    });
    if (!result.ok) return result;
    setStart(NO_NODE);
    setEnd(NO_NODE);
    setLabel("");
    onAdded();
    return operationOk(undefined);
  }

  const { commit } = useGuiFieldDraft({
    documentId,
    blockId,
    hasPending,
    inputKey: () =>
      JSON.stringify([startRef.current, endRef.current, labelRef.current]),
    commitAll: () => addPending(false),
    unappliedValues: () => [
      ...(startRef.current === NO_NODE
        ? []
        : [{ label: text.newEdgeStart, value: startRef.current }]),
      ...(endRef.current === NO_NODE
        ? []
        : [{ label: text.newEdgeEnd, value: endRef.current }]),
      ...(labelRef.current === ""
        ? []
        : [{ label: text.newEdgeLabel, value: labelRef.current }]),
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
    { value: NO_NODE, label: text.choose },
    ...nodes.map((node) => ({
      value: node.id,
      label: text.nodeOption(oneLine(node.displayLabel), node.id),
    })),
  ];
  const noNodes = nodes.length === 0;
  return (
    <div className="diagram-gui__add">
      <h4 className="diagram-gui__heading">{text.addEdgeHeading}</h4>
      <GuiSelect
        label={text.newEdgeStart}
        value={start}
        options={options}
        disabled={busy || noNodes}
        reasonId={hintId}
        onChange={setStart}
      />
      <GuiSelect
        label={text.newEdgeEnd}
        value={end}
        options={options}
        disabled={busy || noNodes}
        reasonId={hintId}
        onChange={setEnd}
      />
      <GuiTextField
        label={text.newEdgeLabel}
        value={label}
        onChange={setLabel}
        onCommit={leaveUnchanged}
        onEnter={() => void add()}
        busy={busy}
        multiline
      />
      <div className="diagram-gui__actions">
        <GuiButton
          label={text.addEdge}
          disabled={busy || noNodes}
          reasonId={hintId}
          onPress={() => void add()}
        />
      </div>
      {noNodes && (
        <p id={hintId} className="diagram-gui__hint">
          {text.noNodesForEdge}
        </p>
      )}
    </div>
  );
}
