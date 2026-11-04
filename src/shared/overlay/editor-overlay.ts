// Something an editor opens outside its own element (a portal on the page), such as the
// add dialog of the diagram GUI. Focus moving into it is not leaving the editor.
export const EDITOR_OVERLAY_ATTRIBUTE = "data-editor-overlay";

export function isInsideEditorOverlay(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(`[${EDITOR_OVERLAY_ATTRIBUTE}]`) !== null
  );
}
