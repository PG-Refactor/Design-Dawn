import { useEffect, useRef } from "react";
import {
  createAppRequestHandler,
  createSettingsChangeHandler,
} from "./app-request-handler";
import type { WindowCloseStatus } from "./use-window-close-save";
import { useWorkspaceServices } from "./workspace-services-context";

// Handles `openDocument` requests and `settingsChanged` notifications from Rust for the
// lifetime of the shell. Registered once;
// the latest actions are read through a ref, so re-renders never re-subscribe.
export function useAppRequests(closeStatus: WindowCloseStatus): void {
  const {
    actions,
    appRequestSource,
    themeController,
    languageController,
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
        applyAutoSave: (enabled) => autoSaveController.applyExternal(enabled),
      }),
    );
    return () => {
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
    autoSaveController,
  ]);
}
