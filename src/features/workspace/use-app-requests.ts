import { useEffect, useRef } from "react";
import {
  createAppRequestHandler,
  createSettingsChangeHandler,
} from "./app-request-handler";
import type { WindowCloseStatus } from "./use-window-close-save";
import { useWorkspaceServices } from "./workspace-services-context";

// Handles `openDocument` requests, `settingsChanged` notifications and the events of the
// Project's other windows from Rust for the lifetime of the shell. Registered once;
// the latest actions are read through a ref, so re-renders never re-subscribe.
export function useAppRequests(closeStatus: WindowCloseStatus): void {
  const {
    actions,
    appRequestSource,
    themeController,
    languageController,
    textSizeController,
    autoSaveController,
  } = useWorkspaceServices();
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
    // After the open listener: subscribing makes Rust send what is unacknowledged.
    const unsubscribeSettings = appRequestSource.subscribeSettings(
      createSettingsChangeHandler({
        applyThemePreference: (preference) =>
          themeController.applyExternal(preference),
        applyLanguagePreference: (preference) =>
          languageController.applyExternal(preference),
        applyTextSize: (size) => textSizeController.applyExternal(size),
        applyAutoSave: (enabled) => autoSaveController.applyExternal(enabled),
      }),
    );
    // Events from the other windows of the Project. Each waits for the start-up request (a
    // Document window opens its Project with it), which the actions share.
    const unsubscribeWindowEvents = appRequestSource.subscribeWindowEvents(
      (event) => {
        void latest.current.actions.openLaunchRequest().then(() => {
          const { actions } = latest.current;
          switch (event.kind) {
            case "receiveDocument":
              void actions.receiveDocument(event.transferId);
              return;
            case "activateDocument":
              actions.showDocumentFromOtherWindow(event.documentId);
              return;
            case "projectTreeChanged":
              void actions.refreshProjectTree();
              return;
            // Asked by the AI access prompt (`AiAccessRequestPrompt`).
            case "aiAccessRequested":
              return;
          }
        });
      },
    );
    return () => {
      unsubscribeWindowEvents();
      unsubscribeSettings();
      unsubscribe();
      stopWaiting();
      handler.dispose();
    };
  }, [
    appRequestSource,
    closeStatus,
    themeController,
    languageController,
    textSizeController,
    autoSaveController,
  ]);
}
