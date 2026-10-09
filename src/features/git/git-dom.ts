// Markers the diff view uses to hand the focus back to the change list, which lives in
// another part of the page. Looked up inside the workspace body so several windows or
// test shells in one document do not meet.
export const GIT_CHANGE_LIST_ATTRIBUTE = "data-git-change-list";
export const GIT_CHANGE_HEADING_ATTRIBUTE = "data-git-change-heading";
export const WORKSPACE_BODY_SELECTOR = ".workspace-shell__body";

// The previously selected row if it is still shown, else the list's roving row, else the
// heading. Found before the selection is cleared, because clearing removes the marker.
export function findChangeListFocusTarget(
  from: Element | null,
): HTMLElement | null {
  const list = from
    ?.closest(WORKSPACE_BODY_SELECTOR)
    ?.querySelector(`[${GIT_CHANGE_LIST_ATTRIBUTE}]`);
  if (list === null || list === undefined) return null;
  return (
    list.querySelector<HTMLElement>('[role="option"][aria-selected="true"]') ??
    list.querySelector<HTMLElement>('[role="option"][tabindex="0"]') ??
    list.querySelector<HTMLElement>(`[${GIT_CHANGE_HEADING_ATTRIBUTE}]`)
  );
}
