import { useEffect, useRef } from "react";
import { createAppRequestHandler } from "./app-request-handler";
import type { WindowCloseStatus } from "./use-window-close-save";
import { useWorkspaceServices } from "./workspace-services-context";

// Handles `openDocument` requests from Rust for the lifetime of the shell. Registered once;
// the latest actions are read through a ref, so re-renders never re-subscribe.
export function useAppRequests(closeStatus: WindowCloseStatus): void {
  const { actions, appRequestSource } = useWorkspaceServices();
  const latest = useRef({ actions });
  latest.current = { actions };

  useEffect(() => {
    const handler = createAppRequestHandler({
      openDocument: (documentId) =>
        latest.current.actions.openDocumentFromRequest(documentId),
      acknowledge: (requestId) =>
        appRequestSource.acknowledgeOpenRequest(requestId),
      isClosing: () => closeStatus.isClosing(),
      whenReady: () => latest.current.actions.openLaunchRequest(),
    });
    const stopWaiting = closeStatus.onReleased(() => handler.resume());
    const unsubscribe = appRequestSource.subscribe((request) =>
      handler.handle(request),
    );
    return () => {
      unsubscribe();
      stopWaiting();
      handler.dispose();
    };
  }, [appRequestSource, closeStatus]);
}
