import { useEffect, useMemo, useRef } from "react";
import { abandonPendingPrints } from "../export/print-frame";
import {
  createWindowCloseHandler,
  type WindowCloseHandler,
} from "./window-close";
import { useWorkspaceServices } from "./workspace-services-context";

// What other window-level hooks may ask of the close handling (read only).
export type WindowCloseStatus = Pick<
  WindowCloseHandler,
  "isClosing" | "onReleased"
>;

// Saves before the window closes. Registered once with the close request source: the latest
// services are read through a ref, so re-renders never re-subscribe, and unmounting removes
// the listener. Returns the close handling's status so app requests can wait while a close
// is in progress.
export function useWindowCloseSave(): WindowCloseStatus {
  const { actions, viewportPersistence, closeRequestSource } =
    useWorkspaceServices();
  const latest = useRef({ actions, viewportPersistence, closeRequestSource });
  latest.current = { actions, viewportPersistence, closeRequestSource };

  // One handler per mount: its in-progress flag must outlive re-renders.
  const handleRequest = useMemo(
    () =>
      createWindowCloseHandler(() => ({
        saveAll: () => latest.current.actions.saveAll(),
        finishViewportSaves: () =>
          latest.current.viewportPersistence.waitForSaves(),
        closeRequestSource: latest.current.closeRequestSource,
        needsConfirmation: () =>
          latest.current.actions.windowCloseNeedsConfirmation(),
        askUnsavedClose: () => latest.current.actions.askUnsavedWindowClose(),
      })),
    [],
  );

  useEffect(
    () =>
      latest.current.closeRequestSource.subscribe((request) => {
        // A print dialog left open would sit over the question about unsaved changes.
        abandonPendingPrints();
        void handleRequest(request);
      }),
    [handleRequest],
  );

  return handleRequest;
}
