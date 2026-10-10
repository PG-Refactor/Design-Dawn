import { useCallback } from "react";
import type {
  ApplicationState,
  ContentLoadStatus,
} from "../../application/state/application-state";
import type {
  BlockId,
  DocumentId,
  SheetId,
} from "../../domain/shared/entity-id";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { useUiState } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";

export interface TextBlockContent {
  readonly status: ContentLoadStatus | undefined;
  readonly text: string | undefined;
  // Whether this block is the one being edited. Comes from UI state; the text comes from
  // the application state.
  readonly editing: boolean;
}

export function useTextBlockContent(
  documentId: DocumentId,
  sheetId: SheetId,
  blockId: BlockId,
): TextBlockContent {
  const { applicationStore } = useWorkspaceServices();
  const status = useStoreSelector(
    applicationStore,
    useCallback(
      (application: ApplicationState) =>
        application.documents.get(documentId)?.contentStatus.get(blockId),
      [documentId, blockId],
    ),
  );
  const text = useStoreSelector(
    applicationStore,
    useCallback(
      (application: ApplicationState) =>
        application.documents.get(documentId)?.contents.get(blockId),
      [documentId, blockId],
    ),
  );
  const editing = useUiState(
    useCallback(
      (ui) =>
        ui.editingBlock?.sheetId === sheetId &&
        ui.editingBlock.blockId === blockId,
      [sheetId, blockId],
    ),
  );
  return { status, text, editing };
}
