import { useEffect } from "react";
import type { ThemeState } from "../../application/theme/theme-controller";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { useWorkspaceModel } from "./workspace-hooks";
import { useWorkspaceServices } from "./workspace-services-context";

const selectThemePreference = (state: ThemeState) => state.preference;

// Keeps the window's title bar naming the open Project (renames included), and drawn light
// or dark like the theme.
export function useWindowTitle(): void {
  const { windowTitle, themeController } = useWorkspaceServices();
  const themePreference = useStoreSelector(
    themeController.store,
    selectThemePreference,
  );
  const projectName = useWorkspaceModel(
    (application) => application.project?.project.name ?? null,
  );
  useEffect(() => {
    if (windowTitle === undefined) return;
    void windowTitle.showProject(projectName).then((shown) => {
      if (!shown.ok)
        console.error("failed to set the window title", shown.error);
    });
  }, [windowTitle, projectName]);
  useEffect(() => {
    if (windowTitle === undefined) return;
    void windowTitle.applyTheme(themePreference).then((applied) => {
      if (!applied.ok)
        console.error("failed to set the window theme", applied.error);
    });
  }, [windowTitle, themePreference]);
}
