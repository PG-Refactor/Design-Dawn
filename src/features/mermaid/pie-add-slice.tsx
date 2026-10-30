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
import type { PieOperation } from "../../domain/diagram/pie/pie-operations";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { GuiButton, GuiTextField } from "./gui-controls";
import { useGuiFieldDraft } from "./use-gui-field-draft";

export interface PieAddSliceProps {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly busy: boolean;
  readonly runDraft: (
    operation: PieOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  readonly onInvalidInput: (message: string) => void;
  readonly onAdded: () => void;
  readonly labelInputRef: Ref<HTMLInputElement>;
  // Filled with "does the form hold input", so switching to Source can refuse while it does.
  readonly hasInputRef: MutableRefObject<(() => boolean) | null>;
}

// A new slice is one operation from two fields, so only Enter and the button add it:
// leaving the label field for the value field must not add half a slice. Any text in the
// form counts as a pending draft (the unsaved-close check sees it). Only an explicit save
// request (save-all, "save" in the unsaved-close dialog) adds it besides Enter / the button;
// switching to Source and leaving the editor never do (they report instead). Adding appends
// the slice at the end, so it does not depend on where the other slices are.
export function PieAddSlice({
  documentId,
  blockId,
  busy,
  runDraft,
  onInvalidInput,
  onAdded,
  labelInputRef,
  hasInputRef,
}: PieAddSliceProps) {
  const gui = useMessages().mermaid.gui;
  const [label, setLabelState] = useState("");
  const [value, setValueState] = useState("");
  const labelRef = useRef("");
  const valueRef = useRef("");

  function setLabel(text: string): void {
    labelRef.current = text;
    setLabelState(text);
  }
  function setValue(text: string): void {
    valueRef.current = text;
    setValueState(text);
  }

  // Leaving a field of the form applies nothing (see above).
  const leaveUnchanged = async () => true;

  const hasPending = () => labelRef.current !== "" || valueRef.current !== "";

  // `explicit`: the user pressed Enter / the button, so an empty form is a mistake to
  // report; for save-all and closing an empty form is simply nothing pending.
  async function addPending(explicit: boolean): Promise<OperationResult<void>> {
    if (!explicit && !hasPending()) return operationOk(undefined);
    if (labelRef.current.trim() === "") {
      onInvalidInput(gui.labelRequired);
      return operationErr(
        "invalidDiagramOperation",
        "labelRequired: the new slice has no label",
      );
    }
    const result = await runDraft({
      kind: "addSlice",
      label: labelRef.current,
      valueText: valueRef.current,
    });
    if (!result.ok) return result;
    setLabel("");
    setValue("");
    onAdded();
    return operationOk(undefined);
  }

  const { commit } = useGuiFieldDraft({
    documentId,
    blockId,
    hasPending,
    inputKey: () => JSON.stringify([labelRef.current, valueRef.current]),
    // Reached only by the registry (save-all / save and close): an explicit save request.
    commitAll: () => addPending(false),
    unappliedValues: () => [
      ...(labelRef.current === ""
        ? []
        : [{ label: gui.newLabelField, value: labelRef.current }]),
      ...(valueRef.current === ""
        ? []
        : [{ label: gui.newValueField, value: valueRef.current }]),
    ],
    onUnmount: "keep",
  });
  const add = async () => {
    await commit(() => addPending(true), "explicit");
  };
  // Every render: the ref is also restored after the simulated unmount of StrictMode.
  useEffect(() => {
    hasInputRef.current = hasPending;
    return () => {
      hasInputRef.current = null;
    };
  });

  return (
    <div className="diagram-gui__add">
      <h4 className="diagram-gui__heading">{gui.addHeading}</h4>
      <GuiTextField
        label={gui.newLabelField}
        value={label}
        onChange={setLabel}
        onCommit={leaveUnchanged}
        onEnter={() => void add()}
        busy={busy}
        inputRef={labelInputRef}
      />
      <GuiTextField
        label={gui.newValueField}
        value={value}
        onChange={setValue}
        onCommit={leaveUnchanged}
        onEnter={() => void add()}
        busy={busy}
      />
      <div className="diagram-gui__actions">
        <GuiButton
          label={gui.addSlice}
          disabled={busy}
          onPress={() => void add()}
        />
      </div>
    </div>
  );
}
