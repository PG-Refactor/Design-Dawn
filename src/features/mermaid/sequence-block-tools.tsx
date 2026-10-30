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
  SEQUENCE_WRAP_BLOCKS,
  type SequenceWrapBlock,
} from "../../domain/diagram/sequence/sequence-operation-config";
import type { SequenceOperation } from "../../domain/diagram/sequence/sequence-operations";
import type { SequenceEntryView } from "../../domain/diagram/sequence/sequence-view";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { describeRestriction } from "./diagram-gui-text";
import { GuiButton, GuiSelect, GuiTextField } from "./gui-controls";
import { describeEntry, entryKey } from "./sequence-entry-text";
import { useGuiFieldDraft } from "./use-gui-field-draft";

export interface SequenceBlockToolsProps {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly entries: readonly SequenceEntryView[];
  // The entry selected in the list, resolved against the current text.
  readonly selected: SequenceEntryView | undefined;
  readonly busy: boolean;
  readonly runDraft: (
    operation: SequenceOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  readonly onInvalidInput: (message: string) => void;
  readonly hasInputRef: MutableRefObject<(() => boolean) | null>;
}

const DEFAULT_WRAP_BLOCK: SequenceWrapBlock = "loop";
const NO_THROUGH = "";

// Wraps the selected entry (or a range that starts at it) in a new block, and adds a branch
// to the selected block. Both take the text of the new header from one field. Same rules as
// the add forms: the buttons (and an explicit save request) apply; typed text is a pending
// draft; nothing is applied by leaving the field.
export function SequenceBlockTools({
  documentId,
  blockId,
  entries,
  selected,
  busy,
  runDraft,
  onInvalidInput,
  hasInputRef,
}: SequenceBlockToolsProps) {
  const text = useMessages().mermaid.gui.sequence;
  const gui = useMessages().mermaid.gui;
  const hintId = useId();
  const [block, setBlockState] =
    useState<SequenceWrapBlock>(DEFAULT_WRAP_BLOCK);
  const [through, setThroughState] = useState(NO_THROUGH);
  const [headerText, setHeaderTextState] = useState("");
  const blockRef = useRef<SequenceWrapBlock>(DEFAULT_WRAP_BLOCK);
  const throughRef = useRef(NO_THROUGH);
  const headerTextRef = useRef("");

  const set =
    <T,>(ref: { current: T }, setState: (value: T) => void) =>
    (value: T) => {
      ref.current = value;
      setState(value);
    };
  const setBlock = set(blockRef, setBlockState);
  const setThrough = set(throughRef, setThroughState);
  const setHeaderText = set(headerTextRef, setHeaderTextState);

  const leaveUnchanged = async () => true;
  const hasPending = () => headerTextRef.current !== "";

  // The text is not an operation of its own: a save request with text typed here is told
  // to press one of the buttons instead of guessing which one was meant.
  async function commitPending(): Promise<OperationResult<void>> {
    if (!hasPending()) return operationOk(undefined);
    onInvalidInput(text.blockToolsPending);
    return operationErr(
      "invalidDiagramOperation",
      "blockToolsPending: the text of a new block or branch is not applied",
    );
  }

  const { commit } = useGuiFieldDraft({
    documentId,
    blockId,
    hasPending,
    inputKey: () => JSON.stringify([blockRef.current, headerTextRef.current]),
    commitAll: commitPending,
    unappliedValues: () =>
      headerTextRef.current === ""
        ? []
        : [{ label: text.blockToolsText, value: headerTextRef.current }],
    onUnmount: "keep",
  });
  useEffect(() => {
    hasInputRef.current = hasPending;
    return () => {
      hasInputRef.current = null;
    };
  });

  const wrappable =
    selected?.kind === "message" ||
    selected?.kind === "note" ||
    selected?.kind === "blockStart"
      ? selected
      : undefined;
  const ends = (wrappable?.wrapEnds ?? []).flatMap((end) => {
    const key = `${end.index}:${end.fingerprint}`;
    const entry = entries.find((candidate) => entryKey(candidate) === key);
    return entry === undefined ? [] : [{ end, key, entry }];
  });
  // The range may only end at an entry that is still offered for the selection.
  const chosenEnd =
    ends.find((candidate) => candidate.key === through) ?? ends[0];

  async function wrap(): Promise<void> {
    if (wrappable === undefined || chosenEnd === undefined) return;
    const from = wrappable.target;
    const to = chosenEnd.end;
    const written = headerTextRef.current;
    const run = async (): Promise<OperationResult<void>> => {
      const result = await runDraft({
        kind: "wrapInBlock",
        from,
        to,
        block: blockRef.current,
        text: written,
      });
      if (!result.ok) return result;
      setHeaderText("");
      setThrough(NO_THROUGH);
      return operationOk(undefined);
    };
    await commit(run, "explicit");
  }
  async function addBranch(): Promise<void> {
    if (selected?.kind !== "blockStart") return;
    const target = selected.target;
    const run = async (): Promise<OperationResult<void>> => {
      const result = await runDraft({
        kind: "addBranch",
        target,
        text: headerTextRef.current,
      });
      if (!result.ok) return result;
      setHeaderText("");
      return operationOk(undefined);
    };
    await commit(run, "explicit");
  }

  const wrapReason =
    wrappable !== undefined && chosenEnd === ends[0]
      ? describeRestriction(gui, wrappable.wrapRestriction)
      : null;
  const branchReason =
    selected?.kind === "blockStart"
      ? describeRestriction(gui, selected.addBranchRestriction)
      : null;
  const reasons = [wrapReason, branchReason].filter(
    (reason) => reason !== null,
  );
  return (
    <div className="diagram-gui__add">
      <h4 className="diagram-gui__heading">{text.blockToolsHeading}</h4>
      {wrappable === undefined && selected?.kind !== "blockStart" && (
        <p className="diagram-gui__hint">{text.blockToolsHint}</p>
      )}
      {wrappable !== undefined && (
        <>
          <GuiSelect
            label={text.wrapBlockField}
            value={block}
            options={SEQUENCE_WRAP_BLOCKS.map((name) => ({
              value: name,
              label: text.blocks[name],
            }))}
            disabled={busy}
            onChange={(value) => {
              const picked = SEQUENCE_WRAP_BLOCKS.find(
                (name) => name === value,
              );
              if (picked !== undefined) setBlock(picked);
            }}
          />
          <GuiSelect
            label={text.wrapThroughField}
            value={chosenEnd?.key ?? NO_THROUGH}
            options={ends.map((candidate, position) => ({
              value: candidate.key,
              label:
                position === 0
                  ? text.wrapThroughSelf
                  : describeEntry(text, candidate.entry),
            }))}
            disabled={busy || ends.length < 2}
            onChange={setThrough}
          />
        </>
      )}
      {(wrappable !== undefined || selected?.kind === "blockStart") && (
        <GuiTextField
          label={text.blockToolsText}
          value={headerText}
          onChange={setHeaderText}
          onCommit={leaveUnchanged}
          onEnter={() => void (wrappable === undefined ? addBranch() : wrap())}
          busy={busy}
        />
      )}
      <div className="diagram-gui__actions">
        {wrappable !== undefined && (
          <GuiButton
            label={text.wrapInBlock}
            disabled={busy || wrapReason !== null}
            reasonId={hintId}
            onPress={() => void wrap()}
          />
        )}
        {selected?.kind === "blockStart" && selected.branchKeyword !== null && (
          <GuiButton
            label={text.addBranch}
            disabled={busy || branchReason !== null}
            reasonId={hintId}
            onPress={() => void addBranch()}
          />
        )}
      </div>
      {reasons.length > 0 && (
        <p id={hintId} className="diagram-gui__hint">
          {[...new Set(reasons)].map((reason) => (
            <span key={reason} className="diagram-gui__reason">
              {reason}{" "}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
