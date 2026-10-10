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

export function leftPanelTabId(mode: string): string {
  return `left-panel-tab-${mode}`;
}

export const LEFT_PANEL_PANEL_ID = "left-panel-panel";

// The side is a fixed word and the path is encoded, so the id has no spaces (an id list in
// `aria-controls` is space separated).
export function diffTabId(path: string, side: string): string {
  return `diff-tab-${side}-${encodeURIComponent(path)}`;
}

export const DIFF_PANEL_ID = "diff-panel";
