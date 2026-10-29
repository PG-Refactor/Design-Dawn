import { applyTextEdits, type TextEdit } from "../../domain/diagram/text-edit";
import type {
  BlockId,
  DocumentId,
  SheetId,
} from "../../domain/shared/entity-id";
import { editBlockContentCommand } from "../commands/content-commands";
import type { DocumentSession } from "../document-session/document-session";
import {
  fromDomainResult,
  type OperationResult,
  operationErr,
  operationOk,
} from "../ports/operation-error";

export interface ApplyDiagramEditsRequest {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  readonly blockId: BlockId;
  // The text the GUI computed its edits against. The edits' offsets mean nothing for any
  // other text, so a block that changed in the meantime (typing, undo, external reload)
  // rejects the whole set instead of editing at shifted positions.
  readonly expectedSource: string;
  readonly edits: readonly TextEdit[];
}

export interface ApplyDiagramEditsOutcome {
  // False when the edits left the text as it was; no command ran and history is untouched.
  readonly changed: boolean;
}

// The loaded text of a Mermaid block, or the reason it cannot be edited. Shared by every
// path that edits a diagram so they refuse the same cases the same way.
export function readMermaidBlockSource(
  session: DocumentSession,
  documentId: DocumentId,
  sheetId: SheetId,
  blockId: BlockId,
): OperationResult<string> {
  const state = session.getState();
  if (state.document.documentId !== documentId) {
    return operationErr("entityNotFound", `document not open: ${documentId}`);
  }
  const block = state.sheets
    .get(sheetId)
    ?.blocks.find((candidate) => candidate.blockId === blockId);
  if (block === undefined) {
    return operationErr("entityNotFound", `block not found: ${blockId}`);
  }
  if (block.blockType !== "mermaid") {
    return operationErr(
      "unsupportedBlockType",
      `diagram edits apply to mermaid blocks, not ${block.blockType}`,
    );
  }
  const content = state.contents.get(blockId);
  if (content === undefined) {
    return operationErr(
      "notWritable",
      `content of block ${blockId} is not loaded`,
    );
  }
  return operationOk(content);
}

// Applies one GUI operation (a set of text edits) to a Mermaid block through the existing
// content path: exactly one `editBlockContentCommand`, so one undo step and the normal
// auto-save. There is no separate save path here.
//
// Known constraint: `editBlockContentCommand` normalises CRLF to LF for the whole text
// (docs/file-format.md §9.2), so a GUI edit on text that still holds CRLF also rewrites
// the untouched line endings. Rust writes LF but returns an externally created CRLF file
// as it is, so this happens on the first GUI edit of such a file (existing behaviour).
//
// The staleness check and the command are not one atomic step: a command queued ahead of
// this one in the session could still run first. The GUI issues one operation at a time
// and waits for it, which keeps that window empty.
export async function applyDiagramEdits(
  session: DocumentSession,
  request: ApplyDiagramEditsRequest,
): Promise<OperationResult<ApplyDiagramEditsOutcome>> {
  const { documentId, sheetId, blockId, expectedSource, edits } = request;
  const current = readMermaidBlockSource(session, documentId, sheetId, blockId);
  if (!current.ok) return current;
  if (current.value !== expectedSource) {
    return operationErr(
      "staleContent",
      `block ${blockId} changed since the edits were computed`,
    );
  }
  const applied = fromDomainResult(applyTextEdits(current.value, edits));
  if (!applied.ok) return applied;
  if (!applied.value.changed) return operationOk({ changed: false });

  const executed = await session.execute(
    editBlockContentCommand({ sheetId, blockId, text: applied.value.text }),
  );
  return executed.ok ? operationOk({ changed: true }) : executed;
}
