// Port for the windows of one Project: moving a Document to another window (its unsaved
// changes and history travel with it, nothing is saved), taking a Document handed to this
// window, reading the Project again after another window changed its tree, and listing the
// windows a Document can go to. Rust keeps which window holds which Document.

import type { DocumentId, ProjectId } from "../../domain/shared/entity-id";
import type { OperationResult } from "./operation-error";
import type { ProjectSnapshot } from "./persistence-types";

// Where a Document goes: a new window (where it was dropped, in screen pixels, when known)
// or another window of the Project, named as `listProjectWindows` names it.
export type DocumentWindowTarget =
  | {
      readonly kind: "newWindow";
      readonly screenX: number | null;
      readonly screenY: number | null;
    }
  | { readonly kind: "window"; readonly label: string };

export type ProjectWindowRole = "project" | "document";

export interface ProjectWindowInfo {
  readonly label: string;
  readonly role: ProjectWindowRole;
  readonly isSelf: boolean;
  readonly documentIds: readonly DocumentId[];
}

export interface DocumentWindowGateway {
  // On success the target holds the Document; this window drops it without saving.
  transferDocument(
    projectId: ProjectId,
    documentId: DocumentId,
    payload: string,
    target: DocumentWindowTarget,
  ): Promise<OperationResult<void>>;
  // The hand-over addressed to this window (once).
  takeDocumentTransfer(transferId: string): Promise<OperationResult<string>>;
  // The Project as it is on disk; no session is built or replaced.
  getProjectSnapshot(
    projectId: ProjectId,
  ): Promise<OperationResult<ProjectSnapshot>>;
  listProjectWindows(
    projectId: ProjectId,
  ): Promise<OperationResult<readonly ProjectWindowInfo[]>>;
}
