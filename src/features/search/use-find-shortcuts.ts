import { useEffect, useRef } from "react";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { findShortcutTarget } from "./find-shortcuts";
import { requestFind, seedFromSelection } from "./find-store";

// Ctrl+F opens the find box of the shown sheet, Ctrl+Shift+F the Search tab of the sidebar;
// either starts with the selected text (one line) and puts the focus in the box. On
// `window` in the capture phase (inputs stop propagation) and always without the
// webview's own find bar. Registered once; the latest services are read through a ref.
export function useFindShortcuts(): void {
  const services = useWorkspaceServices();
  const latestServices = useRef(services);
  latestServices.current = services;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = findShortcutTarget(event);
      if (target === null) return;
      event.preventDefault();
      const { actions, searchActions } = latestServices.current;
      const seed = seedFromSelection(selectedText());
      if (target === "project") {
        actions.setSidebarCollapsed(false);
        actions.setLeftPanelMode("search");
      }
      requestFind(searchActions.findStore, target, seed);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);
}

// The selected text of the page, or of the text field that has the focus (a field's
// selection is not part of the page's).
function selectedText(): string {
  const active = document.activeElement;
  if (
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLInputElement && active.type === "text")
  ) {
    const { selectionStart, selectionEnd, value } = active;
    if (selectionStart === null || selectionEnd === null) return "";
    return value.slice(selectionStart, selectionEnd);
  }
  return window.getSelection()?.toString() ?? "";
}
