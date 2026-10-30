import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApplyDiagramEditsOutcome } from "../../application/diagram/apply-diagram-edits";
import type {
  OperationError,
  OperationResult,
} from "../../application/ports/operation-error";
import type { DiagramOperation } from "../../domain/diagram/diagram-operation";
import type {
  BlockId,
  DocumentId,
  SheetId,
} from "../../domain/shared/entity-id";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { createDiagramRenderCheck } from "./diagram-render-check";
import { useMermaidRenderer } from "./mermaid-renderer-context";

export interface DiagramOperationTarget {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  readonly blockId: BlockId;
}

// "busy": another operation was still running, so this one was not sent at all.
export type DiagramOperationOutcome = "applied" | "refused" | "busy";

export interface DiagramOperationState {
  // True while an operation is in flight; the GUI blocks further input until it ends.
  readonly busy: boolean;
  // Why the last operation changed nothing; null after a success or a new attempt.
  readonly refusal: OperationError | null;
  // "applied" also covers an operation that left the text as it was.
  readonly apply: (
    operation: DiagramOperation,
  ) => Promise<DiagramOperationOutcome>;
  // For a field's uncommitted value (Enter / leaving the field / save-all / closing): it
  // waits for an operation that is still running instead of being dropped as "busy", and
  // returns the application's own result so the caller can report the refusal. The refusal
  // is also shown inline, like `apply`'s.
  readonly applyDraft: (
    operation: DiagramOperation,
  ) => Promise<OperationResult<ApplyDiagramEditsOutcome>>;
  readonly clearRefusal: () => void;
}

// Sends GUI operations to the application, one at a time. The GUI never holds a diagram
// model: the result of an operation is only "applied" or "refused", and the view is
// derived again from the block's committed text.
export function useDiagramOperation(
  target: DiagramOperationTarget,
): DiagramOperationState {
  const { canvasActions } = useWorkspaceServices();
  const renderer = useMermaidRenderer();
  const renderCheck = useMemo(
    () => createDiagramRenderCheck(renderer),
    [renderer],
  );
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<OperationError | null>(null);
  // A ref as well as state: two events in the same tick (Enter then blur) must not both
  // pass the check before the first render shows `busy`.
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The operation that is running, so a draft commit can wait for it.
  const inFlightRef = useRef<Promise<unknown> | null>(null);

  const { documentId, sheetId, blockId } = target;
  const send = useCallback(
    (
      operation: DiagramOperation,
    ): Promise<OperationResult<ApplyDiagramEditsOutcome>> => {
      busyRef.current = true;
      setBusy(true);
      setRefusal(null);
      const task = (async () => {
        try {
          const result = await canvasActions.applyDiagramOperation({
            documentId,
            sheetId,
            blockId,
            operation,
            renderCheck,
          });
          if (!result.ok && mountedRef.current) setRefusal(result.error);
          return result;
        } finally {
          busyRef.current = false;
          inFlightRef.current = null;
          // The editor can close while the operation runs (focus left it); the operation
          // still finishes, there is just nothing left to update.
          if (mountedRef.current) setBusy(false);
        }
      })();
      inFlightRef.current = task;
      return task;
    },
    [canvasActions, documentId, sheetId, blockId, renderCheck],
  );

  const apply = useCallback(
    async (operation: DiagramOperation): Promise<DiagramOperationOutcome> => {
      if (busyRef.current) return "busy";
      const result = await send(operation);
      return result.ok ? "applied" : "refused";
    },
    [send],
  );

  const applyDraft = useCallback(
    async (operation: DiagramOperation) => {
      while (inFlightRef.current !== null) await inFlightRef.current;
      return send(operation);
    },
    [send],
  );
  const clearRefusal = useCallback(() => setRefusal(null), []);
  return { busy, refusal, apply, applyDraft, clearRefusal };
}
