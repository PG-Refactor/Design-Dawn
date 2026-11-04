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
import type { FlowchartOperation } from "../../domain/diagram/flowchart/flowchart-operations";
import type { FlowchartNodeView } from "../../domain/diagram/flowchart/flowchart-view";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { useAddDialogForm } from "./add-dialog-form";
import { oneLine } from "./flowchart-node-list";
import { GuiButton, GuiSelect, GuiTextField } from "./gui-controls";
import { useGuiFieldDraft } from "./use-gui-field-draft";

export interface FlowchartAddSubgraphProps {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly nodes: readonly FlowchartNodeView[];
  readonly busy: boolean;
  readonly runDraft: (
    operation: FlowchartOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  readonly onInvalidInput: (message: string) => void;
  readonly titleInputRef: Ref<HTMLInputElement | HTMLTextAreaElement>;
  // Filled with "does the form hold input", so switching to Source can refuse while it does.
  readonly hasInputRef: MutableRefObject<(() => boolean) | null>;
}

// The value of the member choice that makes an empty subgraph.
const NO_MEMBER = "";

// Adds a subgraph from a title and, optionally, one node that no subgraph owns yet (a node
// that already belongs to one would stay there: the block that closes first keeps it). Same
// rules as the other add forms: it adds only on Enter / the button, and its input is a
// pending draft that blocks switching to Source.
export function FlowchartAddSubgraph({
  documentId,
  blockId,
  nodes,
  busy,
  runDraft,
  onInvalidInput,
  titleInputRef,
  hasInputRef,
}: FlowchartAddSubgraphProps) {
  const gui = useMessages().mermaid.gui;
  const text = gui.flowchart;
  const [title, setTitleState] = useState("");
  const [memberId, setMemberIdState] = useState(NO_MEMBER);
  const titleRef = useRef("");
  const memberRef = useRef(NO_MEMBER);

  function setTitle(value: string): void {
    titleRef.current = value;
    setTitleState(value);
  }
  function setMemberId(value: string): void {
    memberRef.current = value;
    setMemberIdState(value);
  }

  const leaveUnchanged = async () => true;
  const hasPending = () => titleRef.current !== "";

  // The operation the fields describe; null while something it needs is missing.
  function buildOperation(): FlowchartOperation | null {
    if (titleRef.current.trim() === "") return null;
    return {
      kind: "createSubgraph",
      title: titleRef.current,
      ...(memberRef.current === NO_MEMBER
        ? {}
        : { memberId: memberRef.current }),
    };
  }
  // The add dialog previews this operation and clears the fields when it is cancelled.
  const pendingOperation = buildOperation();
  const dialog = useAddDialogForm(
    pendingOperation === null
      ? null
      : { diagram: "flowchart", operation: pendingOperation },
    () => {
      setTitle("");
      setMemberId(NO_MEMBER);
    },
  );

  async function addPending(explicit: boolean): Promise<OperationResult<void>> {
    if (!explicit && !hasPending()) return operationOk(undefined);
    if (titleRef.current.trim() === "") {
      onInvalidInput(gui.labelRequired);
      return operationErr(
        "invalidDiagramOperation",
        "labelRequired: the new subgraph has no title",
      );
    }
    const operation = buildOperation();
    // Unreachable after the checks above; nothing is added without the required fields.
    if (operation === null) return operationOk(undefined);
    const result = await runDraft(operation);
    if (result.ok) dialog.added();
    if (!result.ok) return result;
    setTitle("");
    setMemberId(NO_MEMBER);
    return operationOk(undefined);
  }

  const { commit } = useGuiFieldDraft({
    documentId,
    blockId,
    hasPending,
    inputKey: () => JSON.stringify([titleRef.current, memberRef.current]),
    commitAll: () => addPending(false),
    unappliedValues: () =>
      titleRef.current === ""
        ? []
        : [{ label: text.newSubgraphTitle, value: titleRef.current }],
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

  const free = nodes.filter((node) => node.ownerId === null);
  return (
    <div className="diagram-gui__add">
      <h4 className="diagram-gui__heading">{text.addSubgraphHeading}</h4>
      <GuiTextField
        label={text.newSubgraphTitle}
        value={title}
        onChange={setTitle}
        onCommit={leaveUnchanged}
        onEnter={() => void add()}
        busy={busy}
        multiline
        inputRef={titleInputRef}
      />
      <GuiSelect
        label={text.newSubgraphMember}
        value={memberId}
        options={[
          { value: NO_MEMBER, label: text.newSubgraphMemberNone },
          ...free.map((node) => ({
            value: node.id,
            label: text.nodeOption(oneLine(node.displayLabel), node.id),
          })),
        ]}
        disabled={busy}
        onChange={setMemberId}
      />
      <div className="diagram-gui__actions">
        <GuiButton
          label={text.addSubgraph}
          disabled={busy}
          onPress={() => void add()}
        />
      </div>
    </div>
  );
}
