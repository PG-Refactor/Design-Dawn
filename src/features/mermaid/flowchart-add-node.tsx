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
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import {
  FLOWCHART_DEFAULT_NEW_NODE_SHAPE,
  FLOWCHART_EDITABLE_SHAPES,
  type FlowchartEditableShape,
} from "../../domain/diagram/flowchart/flowchart-operation-config";
import type { FlowchartOperation } from "../../domain/diagram/flowchart/flowchart-operations";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { useAddDialogForm } from "./add-dialog-form";
import { GuiButton, GuiSelect, GuiTextField } from "./gui-controls";
import { useGuiFieldDraft } from "./use-gui-field-draft";

export interface FlowchartAddNodeProps {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly busy: boolean;
  readonly runDraft: (
    operation: FlowchartOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  readonly onInvalidInput: (message: string) => void;
  // Called with the id the node was given (typed, or made up by the domain: null).
  readonly onAdded: (nodeId: string | null) => void;
  readonly labelInputRef: Ref<HTMLInputElement | HTMLTextAreaElement>;
  // Filled with "does the form hold input", so switching to Source can refuse while it does.
  readonly hasInputRef: MutableRefObject<(() => boolean) | null>;
}

// Adds a node from a label, an optional id and a shape. Same rules as the pie add form: it
// adds only on Enter / the button (and an explicit save request), never when a field is
// left, and its input is a pending draft that blocks switching to Source.
export function FlowchartAddNode({
  documentId,
  blockId,
  busy,
  runDraft,
  onInvalidInput,
  onAdded,
  labelInputRef,
  hasInputRef,
}: FlowchartAddNodeProps) {
  const gui = useMessages().mermaid.gui;
  const text = gui.flowchart;
  const [label, setLabelState] = useState("");
  const [id, setIdState] = useState("");
  const [shape, setShape] = useState<FlowchartEditableShape>(
    FLOWCHART_DEFAULT_NEW_NODE_SHAPE,
  );
  const labelRef = useRef("");
  const idRef = useRef("");
  const shapeRef = useRef<FlowchartEditableShape>(
    FLOWCHART_DEFAULT_NEW_NODE_SHAPE,
  );

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

  // The operation the fields describe; null while something it needs is missing.
  function buildOperation(): FlowchartOperation | null {
    if (labelRef.current.trim() === "") return null;
    const typedId = idRef.current.trim();
    return {
      kind: "addNode",
      label: labelRef.current,
      shape: shapeRef.current,
      ...(typedId === "" ? {} : { id: typedId }),
    };
  }
  // The add dialog previews this operation and clears the fields when it is cancelled.
  const pendingOperation = buildOperation();
  const dialog = useAddDialogForm(
    pendingOperation === null
      ? null
      : { diagram: "flowchart", operation: pendingOperation },
    () => {
      setLabel("");
      setId("");
    },
  );

  async function addPending(explicit: boolean): Promise<OperationResult<void>> {
    if (!explicit && !hasPending()) return operationOk(undefined);
    if (labelRef.current.trim() === "") {
      onInvalidInput(gui.labelRequired);
      return operationErr(
        "invalidDiagramOperation",
        "labelRequired: the new node has no label",
      );
    }
    const typedId = idRef.current.trim();
    const operation = buildOperation();
    // Unreachable after the checks above; nothing is added without the required fields.
    if (operation === null) return operationOk(undefined);
    const result = await runDraft(operation);
    if (result.ok) dialog.added();
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
        : [{ label: text.newNodeLabel, value: labelRef.current }]),
      ...(idRef.current === ""
        ? []
        : [{ label: text.newNodeId, value: idRef.current }]),
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
      <h4 className="diagram-gui__heading">{text.addNodeHeading}</h4>
      <GuiTextField
        label={text.newNodeLabel}
        value={label}
        onChange={setLabel}
        onCommit={leaveUnchanged}
        onEnter={() => void add()}
        busy={busy}
        multiline
        inputRef={labelInputRef}
      />
      <GuiTextField
        label={text.newNodeId}
        value={id}
        onChange={setId}
        onCommit={leaveUnchanged}
        onEnter={() => void add()}
        busy={busy}
      />
      <GuiSelect
        label={text.newNodeShape}
        value={shape}
        options={FLOWCHART_EDITABLE_SHAPES.map((name) => ({
          value: name,
          label: text.shapes[name],
        }))}
        disabled={busy}
        onChange={(value) => {
          const picked = FLOWCHART_EDITABLE_SHAPES.find(
            (name) => name === value,
          );
          if (picked === undefined) return;
          shapeRef.current = picked;
          setShape(picked);
        }}
      />
      <div className="diagram-gui__actions">
        <GuiButton
          label={text.addNode}
          disabled={busy}
          onPress={() => void add()}
        />
      </div>
    </div>
  );
}
