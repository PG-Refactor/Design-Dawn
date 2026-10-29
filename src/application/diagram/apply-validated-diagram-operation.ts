import {
  type DiagramOperation,
  planDiagramOperation,
} from "../../domain/diagram/diagram-operation";
import { applyTextEdits } from "../../domain/diagram/text-edit";
import type {
  BlockId,
  DocumentId,
  SheetId,
} from "../../domain/shared/entity-id";
import { normalizeLineEndings } from "../commands/text-content";
import type { DocumentSession } from "../document-session/document-session";
import {
  fromDomainResult,
  type OperationResult,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import {
  type ApplyDiagramEditsOutcome,
  applyDiagramEdits,
  readMermaidBlockSource,
} from "./apply-diagram-edits";
import type { DiagramRenderCheck } from "./diagram-render-check";

export interface ApplyValidatedDiagramOperationRequest {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  readonly blockId: BlockId;
  readonly operation: DiagramOperation;
}

// One GUI operation, committed only if every gate passes (docs/architecture.md §16.13):
//   1. snapshot the loaded text of the block
//   2. plan the operation against the snapshot (refuses what it cannot do safely)
//   3. apply the edits to get the candidate; re-read it and check its meaning against what
//      the operation promised
//   4. let Mermaid draw the candidate (injected check, awaited)
//   5. commit with `applyDiagramEdits`, whose expectedSource is the snapshot: if the text
//      changed while step 4 was pending, nothing is applied (`staleContent`)
// Any failure leaves the block, its history and the save state untouched. A success is one
// history entry (one undo).
//
// The candidate is checked and drawn in the form that will be stored: the command rewrites
// CRLF to LF for the whole text, so that is the text steps 3 and 4 see.
export async function applyValidatedDiagramOperation(
  session: DocumentSession,
  request: ApplyValidatedDiagramOperationRequest,
  renderCheck: DiagramRenderCheck,
): Promise<OperationResult<ApplyDiagramEditsOutcome>> {
  const { documentId, sheetId, blockId, operation } = request;
  const snapshot = readMermaidBlockSource(
    session,
    documentId,
    sheetId,
    blockId,
  );
  if (!snapshot.ok) return snapshot;

  const plan = fromDomainResult(
    planDiagramOperation(snapshot.value, operation),
  );
  if (!plan.ok) return plan;

  const applied = fromDomainResult(
    applyTextEdits(snapshot.value, plan.value.edits),
  );
  if (!applied.ok) return applied;
  if (!applied.value.changed) return operationOk({ changed: false });

  const candidate = normalizeLineEndings(applied.value.text);
  const verified = fromDomainResult(plan.value.verify(candidate));
  if (!verified.ok) return verified;

  const rendered = await renderCheck(candidate);
  if (!rendered.ok) {
    return operationErr(
      "diagramRenderRejected",
      `renderRejected: ${rendered.message}`,
    );
  }

  return applyDiagramEdits(session, {
    documentId,
    sheetId,
    blockId,
    expectedSource: snapshot.value,
    edits: plan.value.edits,
  });
}
