import { type MutableRefObject, useEffect, useRef } from "react";
import type { ApplyDiagramEditsOutcome } from "../../application/diagram/apply-diagram-edits";
import {
  type OperationResult,
  operationOk,
} from "../../application/ports/operation-error";
import { ganttExcludeTokensOf } from "../../domain/diagram/gantt/gantt-input";
import type { GanttOperation } from "../../domain/diagram/gantt/gantt-operations";
import type { GanttView } from "../../domain/diagram/gantt/gantt-view";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { describeRestriction } from "./diagram-gui-text";
import { GuiDraftLabelField } from "./gui-draft-label-field";
import type { GuiDraftCommit } from "./use-gui-field-draft";

export interface GanttSettingsEditorProps {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  readonly view: GanttView;
  readonly busy: boolean;
  readonly runDraft: (
    operation: GanttOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  readonly onInvalidInput: (message: string) => void;
  // Filled with "commit what is pending in these fields", for the switch to Source.
  readonly commitPendingRef: MutableRefObject<GuiDraftCommit | null>;
}

// The chart-wide fields of Tier 2: the axis date format and the excluded days. Each field
// has its own draft (a chart has one of each, so the target is a constant).
const AXIS_TARGET = { key: "axisFormat" } as const;
const EXCLUDES_TARGET = { key: "excludes" } as const;

export function GanttSettingsEditor({
  documentId,
  blockId,
  view,
  busy,
  runDraft,
  onInvalidInput,
  commitPendingRef,
}: GanttSettingsEditorProps) {
  const gui = useMessages().mermaid.gui;
  const text = gui.gantt;
  const axisCommitRef = useRef<GuiDraftCommit | null>(null);
  const excludesCommitRef = useRef<GuiDraftCommit | null>(null);
  // Every render: the ref is also restored after the simulated unmount of StrictMode.
  useEffect(() => {
    commitPendingRef.current = async () => {
      for (const commit of [axisCommitRef, excludesCommitRef]) {
        const result = await commit.current?.();
        if (result !== undefined && !result.ok) return result;
      }
      return operationOk(undefined);
    };
    return () => {
      commitPendingRef.current = null;
    };
  });
  return (
    <>
      <h4 className="diagram-gui__heading">{text.settingsHeading}</h4>
      <GuiDraftLabelField
        documentId={documentId}
        blockId={blockId}
        label={text.axisFormatField}
        target={AXIS_TARGET}
        targetKey={(target) => target.key}
        committed={view.axisFormat}
        buildOperation={(_target, format): GanttOperation => ({
          kind: "setAxisFormat",
          format,
        })}
        allowEmpty={false}
        multiline={false}
        restrictionText={describeRestriction(
          gui,
          view.axisFormatRestriction,
          text.refusalReasons,
        )}
        hint={text.axisFormatHint}
        applyLabel={text.applyField(text.axisFormatField)}
        revertLabel={text.revertField(text.axisFormatField)}
        itemChangedText={text.itemChanged}
        busy={busy}
        runDraft={runDraft}
        onInvalidInput={onInvalidInput}
        inputRef={null}
        commitPendingRef={axisCommitRef}
      />
      <GuiDraftLabelField
        documentId={documentId}
        blockId={blockId}
        label={text.excludesField}
        target={EXCLUDES_TARGET}
        targetKey={(target) => target.key}
        committed={view.excludes}
        buildOperation={(_target, value): GanttOperation => {
          const tokens = ganttExcludeTokensOf(value);
          return tokens.length === 0
            ? { kind: "clearExcludes" }
            : { kind: "setExcludes", tokens };
        }}
        allowEmpty
        multiline={false}
        restrictionText={describeRestriction(
          gui,
          view.excludesRestriction,
          text.refusalReasons,
        )}
        hint={text.excludesHint}
        applyLabel={text.applyField(text.excludesField)}
        revertLabel={text.revertField(text.excludesField)}
        itemChangedText={text.itemChanged}
        busy={busy}
        runDraft={runDraft}
        onInvalidInput={onInvalidInput}
        inputRef={null}
        commitPendingRef={excludesCommitRef}
      />
    </>
  );
}
