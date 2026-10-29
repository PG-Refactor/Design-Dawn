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
import type { FlowchartOperation } from "../../domain/diagram/flowchart/flowchart-operations";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { GuiButton, GuiTextField } from "./gui-controls";
import {
  type GuiCommitTrigger,
  type GuiDraftCommit,
  useGuiFieldDraft,
} from "./use-gui-field-draft";

export interface FlowchartLabelFieldProps<Target> {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly label: string;
  // The element the field edits as the committed text has it now; undefined when the
  // selection no longer resolves to one (undo, redo or a Source edit removed it).
  readonly target: Target | undefined;
  // Identifies an element across renders; a commit goes to the element the draft was
  // started on, so the domain (or this check) can refuse a stale target.
  readonly targetKey: (target: Target) => string;
  // The label as the committed text has it ("" for an edge without a label).
  readonly committed: string;
  readonly buildOperation: (target: Target, text: string) => FlowchartOperation;
  // An edge label may be emptied (that removes it); a node label may not.
  readonly allowEmpty: boolean;
  // Why the label cannot be changed from the GUI (shown, and the field is read-only).
  readonly restrictionText: string | null;
  readonly busy: boolean;
  readonly runDraft: (
    operation: FlowchartOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  readonly onInvalidInput: (message: string) => void;
  readonly inputRef: Ref<HTMLInputElement | HTMLTextAreaElement>;
  // Filled with "commit what is pending here", for the list and the switch to Source.
  readonly commitPendingRef: MutableRefObject<GuiDraftCommit | null>;
}

// One label draft bound to one element. Rendered with a new `key` whenever the user picks
// an element, so a pick restarts the draft. While the text differs from the committed label
// it is pending: it is never replaced, and a commit that finds the element changed is
// refused with the text kept. Otherwise the field follows the committed text.
export function FlowchartLabelField<Target>({
  documentId,
  blockId,
  label,
  target,
  targetKey,
  committed,
  buildOperation,
  allowEmpty,
  restrictionText,
  busy,
  runDraft,
  onInvalidInput,
  inputRef,
  commitPendingRef,
}: FlowchartLabelFieldProps<Target>) {
  const gui = useMessages().mermaid.gui;
  const hintId = useId();
  const [draft, setDraftState] = useState(committed);
  const draftRef = useRef(committed);
  const baseRef = useRef(committed);
  const boundRef = useRef<Target | undefined>(target);
  const currentRef = useRef(target);
  currentRef.current = target;

  function setDraft(text: string): void {
    draftRef.current = text;
    setDraftState(text);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: setDraft only touches a ref and a state setter.
  useEffect(() => {
    if (draftRef.current !== baseRef.current) return;
    baseRef.current = committed;
    setDraft(committed);
    if (target !== undefined) boundRef.current = target;
  }, [committed, target]);

  const hasPending = () => draftRef.current !== baseRef.current;

  async function commitText(): Promise<OperationResult<void>> {
    const text = draftRef.current;
    if (text === baseRef.current) return operationOk(undefined);
    const refuseLocally = (code: string, message: string) => {
      onInvalidInput(message);
      return operationErr("invalidDiagramOperation", `${code}: ${message}`);
    };
    if (!allowEmpty && text.trim() === "") {
      return refuseLocally("labelRequired", gui.labelRequired);
    }
    const bound = boundRef.current;
    const current = currentRef.current;
    if (
      bound === undefined ||
      current === undefined ||
      targetKey(bound) !== targetKey(current)
    ) {
      return refuseLocally("itemChanged", gui.flowchart.itemChanged);
    }
    const result = await runDraft(buildOperation(bound, text));
    if (!result.ok) return result;
    baseRef.current = text;
    return operationOk(undefined);
  }

  const { commit } = useGuiFieldDraft({
    documentId,
    blockId,
    hasPending,
    inputKey: () => {
      const bound = boundRef.current;
      return JSON.stringify([
        bound === undefined ? null : targetKey(bound),
        draftRef.current,
      ]);
    },
    commitAll: commitText,
    unappliedValues: () =>
      hasPending() ? [{ label, value: draftRef.current }] : [],
    onUnmount: "commit",
  });
  // Every render: the ref is also restored after the simulated unmount of StrictMode.
  useEffect(() => {
    commitPendingRef.current = () => commit(commitText, "implicit");
    return () => {
      commitPendingRef.current = null;
    };
  });

  const restricted = restrictionText !== null;
  const pending = hasPending();
  return (
    <>
      <GuiTextField
        label={label}
        value={draft}
        onChange={(text) => {
          if (!restricted) setDraft(text);
        }}
        onCommit={async (trigger: GuiCommitTrigger) =>
          (await commit(commitText, trigger)).ok
        }
        busy={busy}
        multiline
        readOnly={restricted}
        describedBy={restricted ? hintId : undefined}
        inputRef={inputRef}
      />
      {restricted && (
        <p id={hintId} className="diagram-gui__hint">
          {restrictionText}
        </p>
      )}
      <div className="diagram-gui__actions">
        <GuiButton
          label={gui.apply}
          disabled={busy || restricted}
          reasonId={hintId}
          onPress={() => void commit(commitText, "explicit")}
        />
        <GuiButton
          label={gui.revert}
          disabled={busy || !pending}
          onPress={() => {
            setDraft(baseRef.current);
            const current = currentRef.current;
            if (current !== undefined) boundRef.current = current;
          }}
        />
      </div>
    </>
  );
}
