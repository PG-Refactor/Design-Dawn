import { useEffect, useRef } from "react";
import { CANVAS_KEY_COMMANDS, keyCommandOf } from "../canvas/canvas-keyboard";
import { useWorkspaceServices } from "./workspace-services-context";

// Marks a region whose controls (the canvas toolbar's buttons and menus) take Ctrl/Cmd+Z /
// Shift+Z / Y as the active Document's undo / redo, as the canvas does.
export const HISTORY_KEYS_ATTRIBUTE = "data-history-keys";

// Ctrl/Cmd+Z and redo when no part of the window owns the keys: the focus is nowhere (the
// focused block was just deleted, a menu that held it closed) or on a control of a marked
// region. Without it the key does nothing while Ctrl+S, which works anywhere, would save
// what was meant to be undone. Bubble phase on `window`: the canvas, the tree and editors
// handle the keys first and mark them handled.
export function useHistoryShortcut(): void {
  const services = useWorkspaceServices();
  const latestServices = useRef(services);
  latestServices.current = services;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = keyCommandOf(event);
      if (
        command !== CANVAS_KEY_COMMANDS.undo &&
        command !== CANVAS_KEY_COMMANDS.redo
      ) {
        return;
      }
      const target = event.target;
      const unowned =
        target === document.body ||
        target === document.documentElement ||
        (target instanceof Element &&
          target.closest(`[${HISTORY_KEYS_ATTRIBUTE}]`) !== null &&
          !(target instanceof HTMLInputElement) &&
          !(target instanceof HTMLTextAreaElement));
      if (!unowned) return;
      const { uiStateStore, canvasActions } = latestServices.current;
      const documentId = uiStateStore.getState().activeDocumentId;
      if (documentId === null) return;
      event.preventDefault();
      void (command === CANVAS_KEY_COMMANDS.undo
        ? canvasActions.undo(documentId)
        : canvasActions.redo(documentId));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
