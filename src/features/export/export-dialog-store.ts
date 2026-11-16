// Opening the Export dialog from anywhere (the File menu, a Document's menu in the tree),
// with what it starts on. One dialog per window.

import type { ExportFolderFormat } from "../../application/ports/asset-types";
import type { DocumentId } from "../../domain/shared/entity-id";
import { createStore } from "../../shared/store/store";

export type ExportScope = "sheet" | "document" | "choose";

export interface ExportDialogRequest {
  // Chosen in the menu (Export ▸ Markdown / HTML / PDF).
  readonly format: ExportFolderFormat;
  readonly scope: ExportScope;
  // With `choose`: the Documents ticked at first (all of them when absent).
  readonly documentIds?: readonly DocumentId[];
}

export const exportDialogStore = createStore<{
  readonly request: ExportDialogRequest | null;
}>({ request: null });

export function openExportDialog(request: ExportDialogRequest): void {
  exportDialogStore.setState({ request });
}

export function closeExportDialog(): void {
  exportDialogStore.setState({ request: null });
}
