// Undoing one text change an AI tool made: only while the Block still holds exactly what
// the tool wrote, so a later edit (by the user or another tool) is never thrown away. The
// undo is an ordinary content edit in the app (itself undoable, saved like any edit).

import type { AiHistoryEntry } from "../../application/ports/ai-access-gateway";
import {
  type OperationResult,
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import type { ApplicationStore } from "../../application/state/application-state";
import {
  parseBlockId,
  parseDocumentId,
  parseSheetId,
} from "../../domain/shared/entity-id";
import type { CanvasActions } from "../canvas/canvas-actions";
import type { WorkspaceActions } from "../workspace/workspace-actions";

export interface RevertDependencies {
  readonly applicationStore: ApplicationStore;
  readonly actions: Pick<WorkspaceActions, "openDocument">;
  readonly canvasActions: Pick<
    CanvasActions,
    "loadSheetContents" | "commitContentEdit"
  >;
}

const HEX_RADIX = 16;
const HEX_BYTE_DIGITS = 2;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(HEX_RADIX).padStart(HEX_BYTE_DIGITS, "0"))
    .join("");
}

export function canRevert(entry: AiHistoryEntry): boolean {
  return (
    entry.before !== null &&
    entry.documentId !== null &&
    entry.sheetId !== null &&
    entry.blockId !== null
  );
}

export async function revertAiChange(
  dependencies: RevertDependencies,
  entry: AiHistoryEntry,
): Promise<OperationResult<void>> {
  const documentId = parseDocumentId(entry.documentId ?? "");
  const sheetId = parseSheetId(entry.sheetId ?? "");
  const blockId = parseBlockId(entry.blockId ?? "");
  if (!documentId.ok || !sheetId.ok || !blockId.ok || entry.before === null) {
    return operationErr("invalidDiagramOperation", "notRevertable: entry");
  }
  const opened = await dependencies.actions.openDocument(documentId.value);
  if (!opened.ok) return opened;
  const loaded = await dependencies.canvasActions.loadSheetContents({
    documentId: documentId.value,
    sheetId: sheetId.value,
  });
  if (!loaded.ok) return loaded;
  const current = dependencies.applicationStore
    .getState()
    .documents.get(documentId.value)
    ?.contents.get(blockId.value);
  if (current === undefined) {
    return operationErr("entityNotFound", "the block is no longer there");
  }
  const unchanged =
    current === entry.after ||
    (entry.afterHash !== null &&
      (await sha256Hex(current)) === entry.afterHash);
  if (!unchanged) {
    return operationErr(
      "staleContent",
      "changedSince: the block was changed after the AI",
    );
  }
  const edited = await dependencies.canvasActions.commitContentEdit({
    documentId: documentId.value,
    sheetId: sheetId.value,
    blockId: blockId.value,
    text: entry.before,
  });
  return edited.ok ? operationOk(undefined) : edited;
}
