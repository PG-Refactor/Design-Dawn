import {
  type MutableRefObject,
  type Ref,
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
import type { PieOperation } from "../../domain/diagram/pie/pie-operations";
import type { PieSliceView } from "../../domain/diagram/pie/pie-view";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { GuiButton, GuiTextField } from "./gui-controls";
import type { DiagramOperationOutcome } from "./use-diagram-operation";
import {
  type GuiCommitTrigger,
  type GuiDraftCommit,
  useGuiFieldDraft,
} from "./use-gui-field-draft";

export interface PieSliceEditorProps {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  // The selected slice as the committed text has it now; undefined when the selection no
  // longer resolves to one (undo, redo or a Source edit removed it).
  readonly slice: PieSliceView | undefined;
  readonly sliceCount: number;
  readonly busy: boolean;
  readonly run: (operation: PieOperation) => Promise<DiagramOperationOutcome>;
  readonly runDraft: (
    operation: PieOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  // Changes whenever the user picks a slice, so the drafts restart for it.
  readonly selectionKey: number;
  // Reports input the GUI refuses before asking the application (an empty label, an item
  // that changed under the draft).
  readonly onInvalidInput: (message: string) => void;
  // Called with the focus already moved off the controls the delete removes.
  readonly onDelete: () => Promise<void>;
  readonly onMoved: (toIndex: number) => void;
  // Called before a rename is sent: the slice keeps its place but is about to lose the
  // label the selection knows it by.
  readonly onRenaming: () => void;
  readonly labelInputRef: Ref<HTMLInputElement>;
  // Filled with "commit what is pending here", for the list: choosing another slice commits
  // first and keeps the selection when that fails.
  readonly commitPendingRef: MutableRefObject<GuiDraftCommit | null>;
}

// The slice a draft was started on, and what its two fields were then. A commit goes to
// THIS slice (position + label), never to whichever slice is selected now, so the domain
// can refuse a stale target instead of changing another slice.
interface DraftBinding {
  readonly index: number;
  readonly targetLabel: string;
  readonly displayLabel: string;
  readonly valueText: string;
  // Set after this editor renamed the slice: the label it was renamed to. When the committed
  // text shows that label at the same place, the slice is still the same one and the draft
  // follows it to its new target label. Any other change of the label is not followed.
  readonly renamedTo?: string;
}

type DraftField = "displayLabel" | "valueText";

function bindingOf(slice: PieSliceView): DraftBinding {
  return {
    index: slice.index,
    targetLabel: slice.targetLabel,
    displayLabel: slice.displayLabel,
    valueText: slice.valueText,
  };
}

// Edits the selected slice. The two fields are local drafts; each is applied as its own
// operation (label and value are different edits of the text, so they are different undo
// steps) on Enter, on leaving the field, or with "Apply", which applies whichever changed.
// Both fields are one registered draft group (save-all, closing, switching away).
//
// A field is pending while it differs from the value it was started from. While a field
// is pending the draft stays bound to its slice and the user's text is never replaced:
// when the committed text changes underneath (undo, redo, Source edit) in a way that moves
// or changes that slice, a commit is refused ("the item changed") and the text stays until
// it is retried or reverted. A field that is not pending simply follows the committed text.
export function PieSliceEditor({
  documentId,
  blockId,
  slice,
  selectionKey,
  sliceCount,
  busy,
  run,
  runDraft,
  onInvalidInput,
  onDelete,
  onMoved,
  onRenaming,
  labelInputRef,
  commitPendingRef,
}: PieSliceEditorProps) {
  const gui = useMessages().mermaid.gui;
  const hintId = useId();
  const [labelDraft, setLabelState] = useState(slice?.displayLabel ?? "");
  const [valueDraft, setValueState] = useState(slice?.valueText ?? "");
  const labelRef = useRef(slice?.displayLabel ?? "");
  const valueRef = useRef(slice?.valueText ?? "");
  const boundRef = useRef<DraftBinding | null>(
    slice === undefined ? null : bindingOf(slice),
  );
  const currentRef = useRef(slice);
  currentRef.current = slice;
  const lastSelectionKeyRef = useRef(selectionKey);

  function setLabel(text: string): void {
    labelRef.current = text;
    setLabelState(text);
  }
  function setValue(text: string): void {
    valueRef.current = text;
    setValueState(text);
  }

  function restartFrom(source: PieSliceView): void {
    boundRef.current = bindingOf(source);
    setLabel(source.displayLabel);
    setValue(source.valueText);
  }

  // Brings the binding up to date with the committed text: each field that is not pending
  // follows it, the target follows when nothing is pending, and a rename this editor made
  // is followed to the slice's new target label even while the other field is pending.
  // Called when the committed slice changes and right after a field was applied (the text
  // can have changed before or after that, so both orders must end the same way).
  function follow(committed: PieSliceView): void {
    const bound = boundRef.current;
    if (bound === null) {
      restartFrom(committed);
      return;
    }
    const labelPending = labelRef.current !== bound.displayLabel;
    const valuePending = valueRef.current !== bound.valueText;
    let next = bound;
    if (!labelPending) {
      next = { ...next, displayLabel: committed.displayLabel };
      setLabel(committed.displayLabel);
    }
    if (!valuePending) {
      next = { ...next, valueText: committed.valueText };
      setValue(committed.valueText);
    }
    if (!labelPending && !valuePending) {
      next = {
        ...next,
        index: committed.index,
        targetLabel: committed.targetLabel,
      };
    }
    if (
      next.renamedTo !== undefined &&
      committed.displayLabel === next.renamedTo &&
      committed.index === next.index
    ) {
      next = {
        ...next,
        targetLabel: committed.targetLabel,
        renamedTo: undefined,
      };
    }
    boundRef.current = next;
  }

  // Picking a slice restarts both drafts; otherwise the binding follows the committed text.
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow and restartFrom only touch refs and state setters.
  useEffect(() => {
    const restart = lastSelectionKeyRef.current !== selectionKey;
    lastSelectionKeyRef.current = selectionKey;
    if (slice === undefined) return;
    if (restart) restartFrom(slice);
    else follow(slice);
  }, [slice, selectionKey]);

  const hasPending = (): boolean => {
    const bound = boundRef.current;
    return (
      bound !== null &&
      (labelRef.current !== bound.displayLabel ||
        valueRef.current !== bound.valueText)
    );
  };

  // Whether the slice the draft was started on is no longer, unchanged, what the committed
  // text has at that place.
  function itemChanged(bound: DraftBinding, field: DraftField): boolean {
    const current = currentRef.current;
    return (
      current === undefined ||
      current.index !== bound.index ||
      current.targetLabel !== bound.targetLabel ||
      current[field] !== bound[field]
    );
  }

  function refuseLocally(code: string, message: string): OperationResult<void> {
    onInvalidInput(message);
    return operationErr("invalidDiagramOperation", `${code}: ${message}`);
  }

  // After a field was applied: when the text is unchanged (so nothing will re-render the
  // field), show the committed text; otherwise the new committed text arrives by itself and
  // the field follows it because it no longer differs from its start.
  function settleField(
    field: DraftField,
    text: string,
    outcome: ApplyDiagramEditsOutcome,
  ): void {
    const bound = boundRef.current;
    if (bound === null) return;
    if (outcome.changed || currentRef.current === undefined) {
      boundRef.current = {
        ...bound,
        [field]: text,
        ...(field === "displayLabel" ? { renamedTo: text } : {}),
      };
      if (currentRef.current !== undefined) follow(currentRef.current);
      return;
    }
    const committed = currentRef.current[field];
    boundRef.current = { ...bound, [field]: committed };
    if (field === "displayLabel") setLabel(committed);
    else setValue(committed);
  }

  async function commitValue(): Promise<OperationResult<void>> {
    const bound = boundRef.current;
    const text = valueRef.current;
    if (bound === null || text === bound.valueText)
      return operationOk(undefined);
    if (itemChanged(bound, "valueText")) {
      return refuseLocally("itemChanged", gui.itemChanged);
    }
    const result = await runDraft({
      kind: "setSliceValue",
      target: { index: bound.index, label: bound.targetLabel },
      valueText: text,
    });
    if (!result.ok) return result;
    settleField("valueText", text, result.value);
    return operationOk(undefined);
  }

  async function commitLabel(): Promise<OperationResult<void>> {
    const bound = boundRef.current;
    const text = labelRef.current;
    if (bound === null || text === bound.displayLabel) {
      return operationOk(undefined);
    }
    if (text.trim() === "") {
      return refuseLocally("labelRequired", gui.labelRequired);
    }
    if (itemChanged(bound, "displayLabel")) {
      return refuseLocally("itemChanged", gui.itemChanged);
    }
    onRenaming();
    const result = await runDraft({
      kind: "renameSlice",
      target: { index: bound.index, label: bound.targetLabel },
      label: text,
    });
    if (!result.ok) return result;
    settleField("displayLabel", text, result.value);
    return operationOk(undefined);
  }

  // The value goes first: renaming changes the label the value operation targets by. The
  // first failure stops the rest, and its input stays.
  async function commitBoth(): Promise<OperationResult<void>> {
    const valueResult = await commitValue();
    if (!valueResult.ok) return valueResult;
    return commitLabel();
  }

  const { commit } = useGuiFieldDraft({
    documentId,
    blockId,
    hasPending,
    inputKey: () => {
      const bound = boundRef.current;
      return JSON.stringify([
        bound?.index,
        bound?.targetLabel,
        labelRef.current,
        valueRef.current,
      ]);
    },
    commitAll: commitBoth,
    unappliedValues: () => {
      const bound = boundRef.current;
      if (bound === null) return [];
      return [
        ...(labelRef.current === bound.displayLabel
          ? []
          : [{ label: gui.labelField, value: labelRef.current }]),
        ...(valueRef.current === bound.valueText
          ? []
          : [{ label: gui.valueField, value: valueRef.current }]),
      ];
    },
    onUnmount: "commit",
  });
  // Every render: the ref is also restored after the simulated unmount of StrictMode.
  useEffect(() => {
    commitPendingRef.current = () => commit(commitBoth, "implicit");
    return () => {
      commitPendingRef.current = null;
    };
  });

  function revert(): void {
    const current = currentRef.current;
    if (current !== undefined) {
      restartFrom(current);
      return;
    }
    const bound = boundRef.current;
    if (bound === null) return;
    setLabel(bound.displayLabel);
    setValue(bound.valueText);
  }

  async function move(slicePlace: PieSliceView, toIndex: number) {
    const outcome = await run({
      kind: "moveSlice",
      target: { index: slicePlace.index, label: slicePlace.targetLabel },
      toIndex,
    });
    if (outcome !== "applied") return;
    // Moving does not change what the slice is, so a pending edit stays bound to it.
    const bound = boundRef.current;
    if (
      bound !== null &&
      bound.index === slicePlace.index &&
      bound.targetLabel === slicePlace.targetLabel
    ) {
      boundRef.current = { ...bound, index: toIndex };
    }
    onMoved(toIndex);
  }

  const pending = hasPending();
  // Nothing to show once the slice is gone, unless the user's text would be lost with it.
  if (slice === undefined && !pending) return null;

  const isFirst = slice?.index === 0;
  const isLast = slice !== undefined && slice.index === sliceCount - 1;
  const moveReason = isFirst
    ? gui.alreadyFirst
    : isLast
      ? gui.alreadyLast
      : null;
  const unavailable = busy || slice === undefined;

  return (
    <div className="diagram-gui__editor">
      <h4 className="diagram-gui__heading">{gui.selectedHeading}</h4>
      {slice === undefined && (
        <p className="diagram-gui__hint">{gui.itemGone}</p>
      )}
      <GuiTextField
        label={gui.labelField}
        value={labelDraft}
        onChange={setLabel}
        onCommit={async (trigger: GuiCommitTrigger) =>
          (await commit(commitLabel, trigger)).ok
        }
        busy={busy}
        inputRef={labelInputRef}
      />
      <GuiTextField
        label={gui.valueField}
        value={valueDraft}
        onChange={setValue}
        onCommit={async (trigger: GuiCommitTrigger) =>
          (await commit(commitValue, trigger)).ok
        }
        busy={busy}
      />
      <div className="diagram-gui__actions">
        <GuiButton
          label={gui.apply}
          disabled={busy}
          onPress={() => void commit(commitBoth, "explicit")}
        />
        <GuiButton
          label={gui.revert}
          disabled={busy || !pending}
          onPress={revert}
        />
        <GuiButton
          label={gui.moveUp}
          disabled={unavailable || isFirst}
          reasonId={hintId}
          onPress={() =>
            slice !== undefined && void move(slice, slice.index - 1)
          }
        />
        <GuiButton
          label={gui.moveDown}
          disabled={unavailable || isLast}
          reasonId={hintId}
          onPress={() =>
            slice !== undefined && void move(slice, slice.index + 1)
          }
        />
        <GuiButton
          label={gui.deleteSlice}
          variant="danger"
          disabled={unavailable}
          onPress={() => void onDelete()}
        />
      </div>
      {moveReason !== null && (
        <p id={hintId} className="diagram-gui__hint">
          {moveReason}
        </p>
      )}
    </div>
  );
}
