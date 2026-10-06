import { useEffect, useRef } from "react";
import { isSaveShortcut } from "./save-shortcut";
import { useWorkspaceServices } from "./workspace-services-context";

// Ctrl/Cmd+S runs `saveAll` wherever the focus is. The listener is on `window` in the
// capture phase because inputs (the tree rename box) stop propagation before it would
// bubble; propagation is not stopped here, so those inputs still see the key. Registered
// once: the latest action is read through a ref, so re-renders never re-add it.
export function useSaveShortcut(): void {
  const { actions } = useWorkspaceServices();
  const latestActions = useRef(actions);
  latestActions.current = actions;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSaveShortcut(event)) return;
      // Without this the webview offers its own "save page" dialog.
      event.preventDefault();
      // Failures are already recorded as operation / save errors by the action.
      void latestActions.current.saveAll();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);
}
