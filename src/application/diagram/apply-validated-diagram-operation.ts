import type { DiagramOperation } from "../../domain/diagram/diagram-operation";
import type {
  BlockId,
  DocumentId,
  SheetId,
} from "../../domain/shared/entity-id";
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
import { diagramCandidate } from "./diagram-candidate";
import type { DiagramRenderCheck } from "./diagram-render-check";

export interface ApplyValidatedDiagramOperationRequest {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  readonly blockId: BlockId;
  readonly operation: DiagramOperation;
}

// One GUI operation, committed only if every gate passes:
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

  const candidate = fromDomainResult(
    diagramCandidate(snapshot.value, operation),
  );
  if (!candidate.ok) return candidate;
  if (!candidate.value.changed) return operationOk({ changed: false });

  const rendered = await renderCheck(candidate.value.text);
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
    edits: candidate.value.edits,
  });
}
