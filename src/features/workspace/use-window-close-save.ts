import { useEffect, useRef } from "react";
import { createWindowCloseHandler } from "./window-close";
import { useWorkspaceServices } from "./workspace-services-context";

// Saves before the window closes. Registered once with the close request source: the latest
// services are read through a ref, so re-renders never re-subscribe, and unmounting removes
// the listener.
export function useWindowCloseSave(): void {
  const { actions, viewportPersistence, closeRequestSource } =
    useWorkspaceServices();
  const latest = useRef({ actions, viewportPersistence, closeRequestSource });
  latest.current = { actions, viewportPersistence, closeRequestSource };

  useEffect(() => {
    const handleRequest = createWindowCloseHandler(() => ({
      saveAll: () => latest.current.actions.saveAll(),
      flushViewport: () => latest.current.viewportPersistence.flush(),
      closeRequestSource: latest.current.closeRequestSource,
    }));
    return latest.current.closeRequestSource.subscribe((request) => {
      void handleRequest(request);
    });
  }, []);
}
