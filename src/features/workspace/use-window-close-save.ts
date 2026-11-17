import { useEffect, useMemo, useRef } from "react";
import { askCloseWhilePrinting } from "../export/printing-close";
import { askTemplateEditClose } from "../templates/template-edit-banner";
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
  const {
    actions,
    viewportPersistence,
    closeRequestSource,
    exportActions,
    templateEditor,
  } = useWorkspaceServices();
  const latest = useRef({
    actions,
    viewportPersistence,
    closeRequestSource,
    exportActions,
    templateEditor,
  });
  latest.current = {
    actions,
    viewportPersistence,
    closeRequestSource,
    exportActions,
    templateEditor,
  };

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
        printing: {
          isOpen: () => latest.current.exportActions.printWindowsOpen(),
          confirmStop: askCloseWhilePrinting,
          closeAll: () => latest.current.exportActions.closePrintWindows(),
        },
        templateEdit: {
          isEditing: () => latest.current.templateEditor.isEditing(),
          hasUnsavedChanges: () =>
            latest.current.templateEditor.hasUnsavedChanges(),
          ask: askTemplateEditClose,
          save: () => latest.current.templateEditor.save(),
        },
      })),
    [],
  );

  useEffect(
    () =>
      latest.current.closeRequestSource.subscribe((request) => {
        void handleRequest(request);
      }),
    [handleRequest],
  );

  return handleRequest;
}
