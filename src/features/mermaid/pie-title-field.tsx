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
  operationOk,
} from "../../application/ports/operation-error";
import type { PieOperation } from "../../domain/diagram/pie/pie-operations";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { GuiButton, GuiTextField } from "./gui-controls";
import {
  type GuiCommitTrigger,
  type GuiDraftCommit,
  useGuiFieldDraft,
} from "./use-gui-field-draft";

export interface PieTitleFieldProps {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  // The title statement of the committed source; empty when there is none.
  readonly title: string;
  readonly busy: boolean;
  readonly runDraft: (
    operation: PieOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  // Filled with "commit what is pending here", for the switch to Source.
  readonly leaveRef: MutableRefObject<GuiDraftCommit | null>;
}

// The chart title: text sets it, an empty field (or the button) removes it. The field is
// registered as a draft: it is pending while its trimmed text differs from the committed
// title. The title is not bound to a target (there is only one), so a commit sets the title
// to the typed text whatever the committed title has become meanwhile; the domain still
// refuses what Mermaid would change.
export function PieTitleField({
  documentId,
  blockId,
  title,
  busy,
  runDraft,
  leaveRef,
}: PieTitleFieldProps) {
  const gui = useMessages().mermaid.gui;
  const hintId = useId();
  const [draft, setDraftState] = useState(title);
  const draftRef = useRef(title);
  // The committed title as last seen (or as just applied by this field).
  const committedRef = useRef(title);

  function setDraft(text: string): void {
    draftRef.current = text;
    setDraftState(text);
  }

  // Follows the committed title (undo, redo, Source edits) unless the user has typed
  // something else: that input stays until it is applied or changed back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: setDraft only touches a ref and a state setter.
  useEffect(() => {
    const previous = committedRef.current;
    committedRef.current = title;
    if (draftRef.current.trim() === previous) setDraft(title);
  }, [title]);

  // Resolves to a failure only when the text was refused.
  async function commitTitle(): Promise<OperationResult<void>> {
    const wanted = draftRef.current.trim();
    // Surrounding blanks are never part of a title (Mermaid trims them), so they are not
    // worth a refusal.
    if (wanted === committedRef.current) {
      if (draftRef.current !== wanted) setDraft(wanted);
      return operationOk(undefined);
    }
    const result = await runDraft(
      wanted === ""
        ? { kind: "removeTitle" }
        : { kind: "setTitle", title: wanted },
    );
    if (!result.ok) return result;
    committedRef.current = wanted;
    if (draftRef.current.trim() === wanted) setDraft(wanted);
    return operationOk(undefined);
  }

  const hasPending = () => draftRef.current.trim() !== committedRef.current;
  const { commit } = useGuiFieldDraft({
    documentId,
    blockId,
    hasPending,
    inputKey: () => draftRef.current,
    commitAll: commitTitle,
    unappliedValues: () =>
      hasPending() ? [{ label: gui.titleLabel, value: draftRef.current }] : [],
    onUnmount: "commit",
  });
  const commitField = async (trigger: GuiCommitTrigger): Promise<boolean> =>
    (await commit(commitTitle, trigger)).ok;
  // Every render: the ref is also restored after the simulated unmount of StrictMode.
  useEffect(() => {
    leaveRef.current = () => commit(commitTitle, "implicit");
    return () => {
      leaveRef.current = null;
    };
  });

  const hasTitle = title !== "";
  return (
    <div className="diagram-gui__title">
      <GuiTextField
        label={gui.titleLabel}
        value={draft}
        onChange={setDraft}
        onCommit={commitField}
        busy={busy}
      />
      <div className="diagram-gui__actions">
        <GuiButton
          label={gui.titleApply}
          disabled={busy}
          onPress={() => void commitField("explicit")}
        />
        <GuiButton
          label={gui.titleRemove}
          disabled={busy || !hasTitle}
          reasonId={hintId}
          onPress={() => {
            // Removing is "commit an empty title"; an unapplied text in the field is
            // replaced by it instead of lingering as a pending draft.
            setDraft("");
            void commitField("explicit");
          }}
        />
      </div>
      {!busy && !hasTitle && (
        <p id={hintId} className="diagram-gui__hint">
          {gui.noTitleToRemove}
        </p>
      )}
    </div>
  );
}
