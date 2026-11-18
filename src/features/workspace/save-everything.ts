import type { WorkspaceServices } from "./workspace-services-context";

// An explicit "save all" (Ctrl/Cmd+Shift+S, File > Save All): everything unsaved in the
// open Documents, and the sheets' views (zoom and position), which are kept only when
// saved. The views are saved even when the content had nothing to save, and even when a
// content save failed (a view is not part of the content). Failures are recorded by the
// actions themselves.
export async function saveEverything(
  services: Pick<WorkspaceServices, "actions" | "viewportPersistence">,
): Promise<void> {
  await services.actions.saveAll();
  await services.viewportPersistence.flush();
}

// An explicit "save" (Ctrl/Cmd+S, File > Save): the Document shown, as VS Code saves the
// file in front. With none shown, everything (there is nothing else it could mean).
export async function saveShownDocument(
  services: Pick<
    WorkspaceServices,
    "actions" | "viewportPersistence" | "uiStateStore"
  >,
): Promise<void> {
  const documentId = services.uiStateStore.getState().activeDocumentId;
  if (documentId === null) {
    await saveEverything(services);
    return;
  }
  await services.actions.saveDocument(documentId);
  await services.viewportPersistence.flush();
}
