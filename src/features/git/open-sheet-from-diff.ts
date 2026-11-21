// "Open Sheet" of a diff: shows the Sheet the changed file is in, in the Project, at the
// Block that file belongs to (a Block's text file) or else at the first changed Block; only
// the Sheet (or the Document, for a deleted Sheet) when there is no such Block.

import {
  blockToReveal,
  compareSheetVersions,
} from "../../application/git/sheet-comparison";
import type {
  GitDiffSide,
  GitSheetVersions,
} from "../../application/ports/git-gateway";
import {
  type OperationResult,
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import { parseDocumentId } from "../../domain/shared/entity-id";
import { addOperationError } from "../workspace/ui-state/shell-ui-state";
import type { WorkspaceServices } from "../workspace/workspace-services-context";
import { sheetPathOf } from "./git-sheet-path";

type OpenSheetServices = Pick<
  WorkspaceServices,
  "gitController" | "searchActions" | "actions" | "uiStateStore"
>;

async function reveal(
  services: OpenSheetServices,
  path: string,
  versions: GitSheetVersions,
): Promise<OperationResult<void>> {
  const { actions, searchActions } = services;
  const documentId =
    versions.documentId === null ? null : parseDocumentId(versions.documentId);
  if (documentId === null || !documentId.ok) {
    return operationErr("entityNotFound", "the Document is not known");
  }
  const after = versions.after?.sheet ?? null;
  const sheet = after ?? versions.before?.sheet ?? null;
  const blockId = blockToReveal(
    compareSheetVersions(versions.before, versions.after),
    after,
    sheetPathOf(path)?.documentRelative ?? null,
  );
  if (after !== null && blockId !== null) {
    return searchActions.revealBlock({
      documentId: documentId.value,
      sheetId: after.sheetId,
      blockId,
    });
  }
  const opened = await actions.openDocument(documentId.value);
  if (!opened.ok || after === null || sheet === null) return opened;
  return actions.selectSheet(documentId.value, sheet.sheetId);
}

// `versions`: when the view has them already; otherwise they are read.
export async function openSheetFromDiff(
  services: OpenSheetServices,
  path: string,
  side: GitDiffSide,
  versions: GitSheetVersions | null = null,
): Promise<OperationResult<void>> {
  const read =
    versions === null
      ? await services.gitController.sheetVersions(path, side)
      : operationOk(versions);
  const result = read.ok ? await reveal(services, path, read.value) : read;
  if (!result.ok) {
    services.uiStateStore.setState((state) =>
      addOperationError(state, "openSheetFromDiff", path, result.error),
    );
  }
  return result;
}
