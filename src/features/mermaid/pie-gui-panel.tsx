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
import type { PieOperation } from "../../domain/diagram/pie/pie-operations";
import { readPieChartView } from "../../domain/diagram/pie/pie-view";
import { useMessages } from "../workspace/use-messages";
import {
  DiagramGuiLayout,
  GuiStatus,
  useGuiLayoutState,
} from "./diagram-gui-layout";
import { describeRefusal } from "./diagram-gui-text";
import { PieAddSlice } from "./pie-add-slice";
import { PieSliceEditor } from "./pie-slice-editor";
import { PieSliceList } from "./pie-slice-list";
import { PieTitleField } from "./pie-title-field";
import {
  type DiagramOperationOutcome,
  type DiagramOperationTarget,
  useDiagramOperation,
} from "./use-diagram-operation";
import type { GuiDraftCommit } from "./use-gui-field-draft";

export interface PieGuiPanelProps {
  readonly target: DiagramOperationTarget;
  readonly shortId: string;
  // The block's committed text. The view is derived from it on every render.
  readonly source: string;
  // Filled with "get ready to show Source": commits what is pending in the title and the
  // slice editor, and refuses while the add form holds input. See `leaveGui`.
  readonly leaveRef: MutableRefObject<GuiDraftCommit | null>;
}

// Which slice is selected: its position, and the label it had when it was chosen (null
// when only the position is known, for a slice that was just added or renamed). Component
// state, separate from the canvas's block selection.
const SLICES_TAB = "slices";
const ADD_SLICE = "slice";

interface SliceSelection {
  readonly index: number;
  readonly label: string | null;
}

export function PieGuiPanel({
  target,
  shortId,
  source,
  leaveRef,
}: PieGuiPanelProps) {
  const gui = useMessages().mermaid.gui;
  const view = useMemo(() => readPieChartView(source), [source]);
  const operation = useDiagramOperation(target);
  const { busy } = operation;
  const [selection, setSelection] = useState<SliceSelection | null>(null);
  // Counts the user's picks; the slice editor restarts its drafts when it changes.
  const [selectionKey, setSelectionKey] = useState(0);
  const [inputError, setInputError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const editorLabelRef = useRef<HTMLInputElement>(null);
  const addLabelRef = useRef<HTMLInputElement>(null);
  const layout = useGuiLayoutState(SLICES_TAB);
  // The slice editor's "commit what is pending", for choosing another slice.
  const commitPendingRef = useRef<GuiDraftCommit | null>(null);
  const titleLeaveRef = useRef<GuiDraftCommit | null>(null);
  const addInputRef = useRef<(() => boolean) | null>(null);
  const { documentId, blockId } = target;

  // The selection is resolved against the committed text each time, so an undo, a redo or
  // an edit made in Source can never leave it pointing at a different slice.
  const selected = useMemo(() => {
    if (selection === null) return undefined;
    const atIndex = view.slices[selection.index];
    if (
      atIndex !== undefined &&
      (selection.label === null || atIndex.targetLabel === selection.label)
    ) {
      return atIndex;
    }
    return view.slices.find((slice) => slice.targetLabel === selection.label);
  }, [selection, view]);

  const run = useCallback(
    async (pieOperation: PieOperation): Promise<DiagramOperationOutcome> => {
      setInputError(null);
      return operation.apply({ diagram: "pie", operation: pieOperation });
    },
    [operation],
  );

  // Same rule as leaving a field: a pending edit is committed first, and when that fails
  // the selection stays (the error is already shown) so the text is not lost.
  const runDraft = useCallback(
    (pieOperation: PieOperation) => {
      setInputError(null);
      return operation.applyDraft({ diagram: "pie", operation: pieOperation });
    },
    [operation],
  );

  async function select(index: number): Promise<void> {
    const committed: OperationResult<void> | undefined =
      await commitPendingRef.current?.();
    if (committed !== undefined && !committed.ok) return;
    setInputError(null);
    operation.clearRefusal();
    setSelectionKey((key) => key + 1);
    setSelection({ index, label: view.slices[index]?.targetLabel ?? null });
  }

  // GUI -> Source. Edits that were typed into the title or the slice editor are committed
  // (a refusal keeps them, and the switch). The add form is NOT committed: a view switch is
  // not a request to add, so input there blocks the switch with a message and stays.
  // Nothing is applied before that check, so a refused switch changes nothing.
  async function leaveGui(): Promise<OperationResult<void>> {
    if (addInputRef.current?.() === true) {
      // The form may be closed: it is opened, so the input that blocks is in view.
      layout.openAdd(ADD_SLICE);
      setInputError(gui.addInputPending);
      return operationErr(
        "invalidDiagramOperation",
        "addInputPending: the add form has input",
      );
    }
    const title = await titleLeaveRef.current?.();
    if (title !== undefined && !title.ok) return title;
    const slice = await commitPendingRef.current?.();
    if (slice !== undefined && !slice.ok) return slice;
    return operationOk(undefined);
  }
  // Every render: the latest closure, and cleared when the panel goes away.
  useEffect(() => {
    leaveRef.current = leaveGui;
    return () => {
      leaveRef.current = null;
    };
  });

  async function deleteSelected(): Promise<void> {
    if (selected === undefined) return;
    // The delete button disappears with the last slice; the focus moves first, because an
    // element that is removed while focused would look like leaving the editor.
    if (view.slices.length > 1) listRef.current?.focus();
    else layout.focusToolbar();
    const outcome = await run({
      kind: "deleteSlice",
      target: { index: selected.index, label: selected.targetLabel },
    });
    if (outcome !== "applied") return;
    const remaining = view.slices.length - 1;
    setSelectionKey((key) => key + 1);
    setSelection(
      remaining > 0
        ? { index: Math.min(selected.index, remaining - 1), label: null }
        : null,
    );
  }

  const refusal =
    operation.refusal === null ? null : describeRefusal(gui, operation.refusal);

  const editor = (
    <>
      {selection !== null && (
        <PieSliceEditor
          documentId={documentId}
          blockId={blockId}
          slice={selected}
          selectionKey={selectionKey}
          sliceCount={view.slices.length}
          busy={busy}
          run={run}
          runDraft={runDraft}
          onInvalidInput={setInputError}
          onDelete={deleteSelected}
          onMoved={(toIndex) =>
            setSelection((current) =>
              current?.index === selected?.index
                ? { index: toIndex, label: selected?.targetLabel ?? null }
                : current,
            )
          }
          onRenaming={() =>
            setSelection((current) =>
              current !== null && current.index === selected?.index
                ? { index: current.index, label: null }
                : current,
            )
          }
          labelInputRef={editorLabelRef}
          commitPendingRef={commitPendingRef}
        />
      )}
    </>
  );

  return (
    <DiagramGuiLayout
      className="diagram-gui__pie"
      state={layout}
      source={source}
      toolbarLabel={gui.addToolbarLabel}
      tabListLabel={gui.listTabsLabel}
      listsLabel={gui.listsSummary}
      settingsLabel={gui.settingsHeading}
      addActions={[
        {
          id: ADD_SLICE,
          label: gui.addSliceToggle,
          menuLabel: gui.addHeading,
          form: (
            <PieAddSlice
              documentId={documentId}
              blockId={blockId}
              busy={busy}
              runDraft={runDraft}
              onInvalidInput={setInputError}
              onAdded={() => {
                setSelectionKey((key) => key + 1);
                setSelection({ index: view.slices.length, label: null });
              }}
              labelInputRef={addLabelRef}
              hasInputRef={addInputRef}
            />
          ),
        },
      ]}
      status={
        <GuiStatus
          busy={busy}
          busyText={gui.busy}
          refusalHeading={gui.refusalHeading}
          refusalDetailLabel={gui.refusalDetailLabel}
          message={inputError ?? refusal?.message ?? null}
          mermaidMessage={
            inputError === null ? (refusal?.mermaidMessage ?? null) : null
          }
        />
      }
      editor={editor}
      tabs={[
        {
          id: SLICES_TAB,
          label: gui.slicesHeading,
          count: view.slices.length,
          content: (
            <PieSliceList
              shortId={shortId}
              slices={view.slices}
              selectedIndex={selected?.index ?? null}
              onSelect={(index) => void select(index)}
              onEnter={() => editorLabelRef.current?.focus()}
              listRef={listRef}
            />
          ),
        },
      ]}
      settings={
        <section
          aria-label={gui.settingsHeading}
          className="diagram-gui__settings"
        >
          <PieTitleField
            documentId={documentId}
            blockId={blockId}
            title={view.title}
            busy={busy}
            runDraft={runDraft}
            leaveRef={titleLeaveRef}
          />
        </section>
      }
    />
  );
}
