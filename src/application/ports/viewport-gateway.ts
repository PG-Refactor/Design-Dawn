// Port for the per-sheet viewport kept as application local state: outside the Project, never part of undo history or Domain values.

import type {
  DocumentId,
  ProjectId,
  SheetId,
} from "../../domain/shared/entity-id";
import type { Viewport } from "../local-state/viewport";
import type { OperationError, OperationResult } from "./operation-error";

export interface SheetViewportSnapshot {
  // Null when nothing is saved for the sheet (or the file was unusable: see `loadIssue`).
  readonly viewport: Viewport | null;
  readonly loadIssue: OperationError | null;
}

export interface ViewportGateway {
  getSheetViewport(
    projectId: ProjectId,
    documentId: DocumentId,
    sheetId: SheetId,
  ): Promise<OperationResult<SheetViewportSnapshot>>;
  saveSheetViewport(
    projectId: ProjectId,
    documentId: DocumentId,
    sheetId: SheetId,
    viewport: Viewport,
  ): Promise<OperationResult<void>>;
}
