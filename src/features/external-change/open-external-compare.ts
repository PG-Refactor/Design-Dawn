import type { DocumentId } from "../../domain/shared/entity-id";
import {
  openCompareTab,
  setCompareContent,
} from "../workspace/ui-state/diff-tabs";
import { addOperationError } from "../workspace/ui-state/shell-ui-state";
import type { WorkspaceServices } from "../workspace/workspace-services-context";

export type CompareServices = Pick<
  WorkspaceServices,
  "uiStateStore" | "externalChangeController"
>;

// Opens the compare tab for one Block text file and fills it. The tab shows "loading" first;
// nothing about the conflict changes.
export async function openExternalCompare(
  services: CompareServices,
  documentId: DocumentId,
  path: string,
): Promise<void> {
  const { uiStateStore, externalChangeController } = services;
  uiStateStore.setState((state) =>
    openCompareTab(state, documentId, path, { status: "loading" }),
  );
  const compared = await externalChangeController.compare(documentId, path);
  if (compared.ok) {
    uiStateStore.setState((state) =>
      setCompareContent(state, documentId, path, {
        status: "loaded",
        comparison: compared.value,
      }),
    );
    return;
  }
  // "Not there / not loaded" is explained in the tab; anything else is a real failure.
  if (compared.error.kind !== "entityNotFound") {
    uiStateStore.setState((state) =>
      addOperationError(state, "checkExternalChange", null, compared.error),
    );
  }
  uiStateStore.setState((state) =>
    setCompareContent(state, documentId, path, { status: "unavailable" }),
  );
}
