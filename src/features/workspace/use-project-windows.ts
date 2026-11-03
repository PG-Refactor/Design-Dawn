import { useEffect, useState } from "react";
import type { ProjectWindowInfo } from "../../application/ports/document-window-gateway";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { useWorkspaceServices } from "./workspace-services-context";

const NO_WINDOWS: readonly ProjectWindowInfo[] = [];

// The windows of this window's Project, for the "move to …" menu items. Read again when
// this window gets the focus (the user is back from another window, where things may have
// moved) and when its own Documents change; a menu opened right after uses what was read.
export function useProjectWindows(): readonly ProjectWindowInfo[] {
  const { actions, applicationStore } = useWorkspaceServices();
  const [windows, setWindows] = useState(NO_WINDOWS);
  const documents = useStoreSelector(
    applicationStore,
    (state) => state.documents,
  );
  const hasProject = useStoreSelector(
    applicationStore,
    (state) => state.project !== null,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `documents` is a trigger, not an input: a Document that left or arrived changes what the windows hold.
  useEffect(() => {
    if (!hasProject) {
      setWindows(NO_WINDOWS);
      return;
    }
    let current = true;
    const read = () => {
      void actions.listProjectWindows().then((listed) => {
        if (current && listed.ok) setWindows(listed.value);
      });
    };
    read();
    window.addEventListener("focus", read);
    return () => {
      current = false;
      window.removeEventListener("focus", read);
    };
  }, [actions, hasProject, documents]);

  return windows;
}
