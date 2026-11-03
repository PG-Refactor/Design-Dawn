import { useEffect } from "react";
import { useWorkspaceModel } from "./workspace-hooks";
import { useWorkspaceServices } from "./workspace-services-context";

// Keeps the window's title bar naming the open Project (renames included).
export function useWindowTitle(): void {
  const { windowTitle } = useWorkspaceServices();
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
}
