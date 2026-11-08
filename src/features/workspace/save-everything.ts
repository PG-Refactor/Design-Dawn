import type { WorkspaceServices } from "./workspace-services-context";

// An explicit save (Ctrl/Cmd+S, File > Save): everything unsaved in the open Documents, and
// the sheets' views (zoom and position), which are kept only when saved. The views are
// saved even when the content had nothing to save, and even when a content save failed (a
// view is not part of the content). Failures are recorded by the actions themselves.
export async function saveEverything(
  services: Pick<WorkspaceServices, "actions" | "viewportPersistence">,
): Promise<void> {
  await services.actions.saveAll();
  await services.viewportPersistence.flush();
}
