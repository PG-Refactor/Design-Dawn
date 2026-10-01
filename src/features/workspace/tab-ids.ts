// Element ids that tie tabs to their panels (aria-controls / aria-labelledby). Entity ids
// are UUIDs, so the derived ids are valid and unique.

import type { DocumentId, SheetId } from "../../domain/shared/entity-id";

export function documentTabId(documentId: DocumentId): string {
  return `document-tab-${documentId}`;
}

export function documentPanelId(documentId: DocumentId): string {
  return `document-panel-${documentId}`;
}

export function sheetTabId(sheetId: SheetId): string {
  return `sheet-tab-${sheetId}`;
}

export function sheetPanelId(documentId: DocumentId): string {
  return `sheet-panel-${documentId}`;
}
