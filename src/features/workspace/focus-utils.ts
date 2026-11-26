// Small DOM focus helpers shared by the modal and the tab / tree widgets.

// Marks the element that should receive focus when the element that had it was removed
// (for example the delete button of an entity that no longer exists).
export const FOCUS_FALLBACK_ATTRIBUTE = "data-focus-fallback";
const FOCUS_FALLBACK_SELECTOR = `[${FOCUS_FALLBACK_ATTRIBUTE}="true"]`;

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function focusableElements(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ].filter((element) => element.getAttribute("aria-hidden") !== "true");
}

export function focusFallbackElement(): void {
  document.querySelector<HTMLElement>(FOCUS_FALLBACK_SELECTOR)?.focus();
}

// Returns focus to `previous` when it is still on the page, else to the fallback.
export function restoreFocus(previous: Element | null): void {
  if (previous instanceof HTMLElement && previous.isConnected) {
    previous.focus();
    return;
  }
  focusFallbackElement();
}

const TREE_SELECTOR = '[role="tree"]';
const TREE_ROW_SELECTOR = '[role="treeitem"]';

function treeRows(tree: HTMLElement): HTMLElement[] {
  return [...tree.querySelectorAll<HTMLElement>(TREE_ROW_SELECTOR)];
}

// A tree step (an undo from the tree or from its notice) may take away the row that has
// the focus, when a creation is undone. The focus then falls to the page, and the next
// Ctrl+Z would reach the open Document instead of the tree. Call this before the step and
// the answer after it: the row now at that place takes the focus back. Focus that went
// somewhere (a dialog the step opened) is left there.
export function holdTreeFocus(): () => void {
  const focused = document.activeElement;
  const tree =
    focused instanceof HTMLElement
      ? focused.closest<HTMLElement>(TREE_SELECTOR)
      : null;
  if (tree === null) return () => undefined;
  const position = treeRows(tree).indexOf(focused as HTMLElement);
  return () => {
    const now = document.activeElement;
    if (!tree.isConnected || (now !== null && now !== document.body)) return;
    const rows = treeRows(tree);
    rows[Math.min(Math.max(position, 0), rows.length - 1)]?.focus();
  };
}
