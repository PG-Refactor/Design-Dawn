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
import type { FlowchartDirection } from "../../domain/diagram/flowchart/flowchart-config";
import type { FlowchartOperation } from "../../domain/diagram/flowchart/flowchart-operations";
import {
  readFlowchartNodeActions,
  readFlowchartView,
} from "../../domain/diagram/flowchart/flowchart-view";
import { useMessages } from "../workspace/use-messages";
import { describeRefusal } from "./diagram-gui-text";
import { FlowchartAddEdge } from "./flowchart-add-edge";
import { FlowchartAddNode } from "./flowchart-add-node";
import { FlowchartAddSubgraph } from "./flowchart-add-subgraph";
import { FlowchartEdgeEditor } from "./flowchart-edge-editor";
import { FlowchartEdgeList } from "./flowchart-edge-list";
import { FlowchartNodeEditor } from "./flowchart-node-editor";
import { FlowchartNodeList } from "./flowchart-node-list";
import { FlowchartSubgraphEditor } from "./flowchart-subgraph-editor";
import { FlowchartSubgraphList } from "./flowchart-subgraph-list";
import { GuiSelect } from "./gui-controls";
import {
  type DiagramOperationOutcome,
  type DiagramOperationTarget,
  useDiagramOperation,
} from "./use-diagram-operation";
import type { GuiDraftCommit } from "./use-gui-field-draft";

export interface FlowchartGuiPanelProps {
  readonly target: DiagramOperationTarget;
  readonly shortId: string;
  // The block's committed text. The view is derived from it on every render.
  readonly source: string;
  // Filled with "get ready to show Source": commits what is pending in the label field and
  // refuses while an add form holds input. See `leaveGui`.
  readonly leaveRef: MutableRefObject<GuiDraftCommit | null>;
}

// Which element is selected: a node or a subgraph by id, an edge by position and id.
// Component state, separate from the canvas's block selection.
type FlowchartSelection =
  | { readonly kind: "node"; readonly id: string }
  | { readonly kind: "subgraph"; readonly id: string }
  | { readonly kind: "edge"; readonly index: number; readonly id: string };

const DIRECTIONS: readonly FlowchartDirection[] = ["TB", "BT", "LR", "RL"];

export function FlowchartGuiPanel({
  target,
  shortId,
  source,
  leaveRef,
}: FlowchartGuiPanelProps) {
  const gui = useMessages().mermaid.gui;
  const text = gui.flowchart;
  const view = useMemo(() => readFlowchartView(source), [source]);
  const operation = useDiagramOperation(target);
  const { busy } = operation;
  const [selection, setSelection] = useState<FlowchartSelection | null>(null);
  // Counts the user's picks; the editor restarts its draft when it changes.
  const [selectionKey, setSelectionKey] = useState(0);
  const [inputError, setInputError] = useState<string | null>(null);
  const nodeListRef = useRef<HTMLDivElement>(null);
  const edgeListRef = useRef<HTMLDivElement>(null);
  const subgraphListRef = useRef<HTMLDivElement>(null);
  const editorLabelRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const addNodeLabelRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const addSubgraphTitleRef = useRef<HTMLInputElement | HTMLTextAreaElement>(
    null,
  );
  const commitPendingRef = useRef<GuiDraftCommit | null>(null);
  const addNodeInputRef = useRef<(() => boolean) | null>(null);
  const addEdgeInputRef = useRef<(() => boolean) | null>(null);
  const addSubgraphInputRef = useRef<(() => boolean) | null>(null);
  const { documentId, blockId } = target;

  // The selection is resolved against the committed text each time, so an undo, a redo or
  // an edit made in Source can never leave it pointing at a different element.
  const selectedNode =
    selection?.kind === "node"
      ? view?.nodes.find((node) => node.id === selection.id)
      : undefined;
  const selectedSubgraph =
    selection?.kind === "subgraph"
      ? view?.subgraphs.find((subgraph) => subgraph.id === selection.id)
      : undefined;
  // Planned once per text and node, not on every render.
  const nodeActions = useMemo(
    () =>
      selection?.kind === "node"
        ? readFlowchartNodeActions(source, selection.id)
        : null,
    [selection, source],
  );
  const selectedEdge = useMemo(() => {
    if (selection?.kind !== "edge" || view === null) return undefined;
    const atIndex = view.edges[selection.index];
    if (atIndex?.id === selection.id) return atIndex;
    return view.edges.find((edge) => edge.id === selection.id);
  }, [selection, view]);

  const run = useCallback(
    async (
      flowOperation: FlowchartOperation,
    ): Promise<DiagramOperationOutcome> => {
      setInputError(null);
      return operation.apply({
        diagram: "flowchart",
        operation: flowOperation,
      });
    },
    [operation],
  );
  const runDraft = useCallback(
    (flowOperation: FlowchartOperation) => {
      setInputError(null);
      return operation.applyDraft({
        diagram: "flowchart",
        operation: flowOperation,
      });
    },
    [operation],
  );

  async function select(next: FlowchartSelection): Promise<void> {
    const committed: OperationResult<void> | undefined =
      await commitPendingRef.current?.();
    if (committed !== undefined && !committed.ok) return;
    setInputError(null);
    operation.clearRefusal();
    setSelectionKey((key) => key + 1);
    setSelection(next);
  }

  // GUI -> Source. A pending label is committed (a refusal keeps it, and the switch). The
  // add forms are NOT committed: a view switch is not a request to add, so input there
  // blocks the switch with a message and stays.
  async function leaveGui(): Promise<OperationResult<void>> {
    if (
      addNodeInputRef.current?.() === true ||
      addEdgeInputRef.current?.() === true ||
      addSubgraphInputRef.current?.() === true
    ) {
      setInputError(gui.addInputPending);
      return operationErr(
        "invalidDiagramOperation",
        "addInputPending: an add form has input",
      );
    }
    const pending = await commitPendingRef.current?.();
    if (pending !== undefined && !pending.ok) return pending;
    return operationOk(undefined);
  }
  useEffect(() => {
    leaveRef.current = leaveGui;
    return () => {
      leaveRef.current = null;
    };
  });

  async function deleteSelectedEdge(): Promise<void> {
    if (selectedEdge === undefined || view === null) return;
    // The delete button disappears with the selection; the focus moves first, because an
    // element that is removed while focused would look like leaving the editor.
    (view.edges.length > 1
      ? edgeListRef.current
      : addNodeLabelRef.current
    )?.focus();
    const outcome = await run({
      kind: "deleteEdge",
      target: { index: selectedEdge.index, id: selectedEdge.id },
    });
    if (outcome !== "applied") return;
    setSelectionKey((key) => key + 1);
    setSelection(null);
  }

  async function deleteSelectedNode(): Promise<void> {
    if (selectedNode === undefined || view === null) return;
    (view.nodes.length > 1
      ? nodeListRef.current
      : addNodeLabelRef.current
    )?.focus();
    const outcome = await run({ kind: "deleteNode", nodeId: selectedNode.id });
    if (outcome !== "applied") return;
    setSelectionKey((key) => key + 1);
    setSelection(null);
  }

  async function dissolveSelectedSubgraph(): Promise<void> {
    if (selectedSubgraph === undefined || view === null) return;
    (view.subgraphs.length > 1
      ? subgraphListRef.current
      : addSubgraphTitleRef.current
    )?.focus();
    const outcome = await run({
      kind: "dissolveSubgraph",
      subgraphId: selectedSubgraph.id,
    });
    if (outcome !== "applied") return;
    setSelectionKey((key) => key + 1);
    setSelection(null);
  }

  if (view === null) return null;
  const refusal =
    operation.refusal === null ? null : describeRefusal(gui, operation.refusal);

  return (
    <div className="diagram-gui__flowchart">
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
      <GuiSelect
        label={text.directionLabel}
        value={view.direction}
        options={DIRECTIONS.map((direction) => ({
          value: direction,
          label: text.directions[direction],
        }))}
        disabled={busy}
        onChange={(value) => {
          const direction = DIRECTIONS.find((candidate) => candidate === value);
          if (direction !== undefined) {
            void run({ kind: "setDirection", direction });
          }
        }}
      />
      <h4 className="diagram-gui__heading">{text.nodesHeading}</h4>
      <FlowchartNodeList
        shortId={shortId}
        nodes={view.nodes}
        selectedId={
          selection?.kind === "node" ? (selectedNode?.id ?? null) : null
        }
        onSelect={(id) => void select({ kind: "node", id })}
        onEnter={() => editorLabelRef.current?.focus()}
        listRef={nodeListRef}
      />
      <h4 className="diagram-gui__heading">{text.edgesHeading}</h4>
      <FlowchartEdgeList
        shortId={shortId}
        edges={view.edges}
        selectedIndex={
          selection?.kind === "edge" ? (selectedEdge?.index ?? null) : null
        }
        onSelect={(index) => {
          const edge = view.edges[index];
          if (edge !== undefined) {
            void select({ kind: "edge", index, id: edge.id });
          }
        }}
        onEnter={() => editorLabelRef.current?.focus()}
        listRef={edgeListRef}
      />
      {selection === null &&
        (view.nodes.length > 0 ||
          view.edges.length > 0 ||
          view.subgraphs.length > 0) && (
          <p className="diagram-gui__hint">{text.noSelection}</p>
        )}
      {selection?.kind === "node" && (
        <FlowchartNodeEditor
          key={selectionKey}
          documentId={documentId}
          blockId={blockId}
          node={selectedNode}
          actions={nodeActions}
          subgraphs={view.subgraphs}
          busy={busy}
          runDraft={runDraft}
          onInvalidInput={setInputError}
          onDelete={deleteSelectedNode}
          labelInputRef={editorLabelRef}
          commitPendingRef={commitPendingRef}
        />
      )}
      {selection?.kind === "edge" && (
        <FlowchartEdgeEditor
          key={selectionKey}
          documentId={documentId}
          blockId={blockId}
          edge={selectedEdge}
          nodes={view.nodes}
          busy={busy}
          runDraft={runDraft}
          onInvalidInput={setInputError}
          onDelete={deleteSelectedEdge}
          labelInputRef={editorLabelRef}
          commitPendingRef={commitPendingRef}
        />
      )}
      <FlowchartAddNode
        documentId={documentId}
        blockId={blockId}
        busy={busy}
        runDraft={runDraft}
        onInvalidInput={setInputError}
        onAdded={(nodeId) => {
          if (nodeId === null) return;
          setSelectionKey((key) => key + 1);
          setSelection({ kind: "node", id: nodeId });
        }}
        labelInputRef={addNodeLabelRef}
        hasInputRef={addNodeInputRef}
      />
      <FlowchartAddEdge
        documentId={documentId}
        blockId={blockId}
        nodes={view.nodes}
        busy={busy}
        runDraft={runDraft}
        onInvalidInput={setInputError}
        onAdded={() => undefined}
        hasInputRef={addEdgeInputRef}
      />
      <h4 className="diagram-gui__heading">{text.subgraphsHeading}</h4>
      <FlowchartSubgraphList
        shortId={shortId}
        subgraphs={view.subgraphs}
        selectedId={
          selection?.kind === "subgraph" ? (selectedSubgraph?.id ?? null) : null
        }
        onSelect={(id) => void select({ kind: "subgraph", id })}
        onEnter={() => editorLabelRef.current?.focus()}
        listRef={subgraphListRef}
      />
      {selection?.kind === "subgraph" && (
        <FlowchartSubgraphEditor
          key={selectionKey}
          documentId={documentId}
          blockId={blockId}
          subgraph={selectedSubgraph}
          busy={busy}
          runDraft={runDraft}
          onInvalidInput={setInputError}
          onDissolve={dissolveSelectedSubgraph}
          labelInputRef={editorLabelRef}
          commitPendingRef={commitPendingRef}
        />
      )}
      <FlowchartAddSubgraph
        documentId={documentId}
        blockId={blockId}
        nodes={view.nodes}
        busy={busy}
        runDraft={runDraft}
        onInvalidInput={setInputError}
        titleInputRef={addSubgraphTitleRef}
        hasInputRef={addSubgraphInputRef}
      />
    </div>
  );
}
