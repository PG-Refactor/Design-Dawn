// Keyboard navigation for the tab lists and the tree, as pure functions on indices, so
// the key map is testable without a DOM. Follows the WAI-ARIA tabs / tree patterns.

export const NAVIGATION_KEYS = {
  arrowLeft: "ArrowLeft",
  arrowRight: "ArrowRight",
  arrowUp: "ArrowUp",
  arrowDown: "ArrowDown",
  home: "Home",
  end: "End",
  enter: "Enter",
  space: " ",
} as const;

// Index to move to for ArrowLeft / ArrowRight (wrapping), Home and End, or null when
// the key does not navigate tabs or there is nothing to move to.
export function tabTargetIndex(
  key: string,
  currentIndex: number,
  count: number,
): number | null {
  if (count === 0) return null;
  const last = count - 1;
  switch (key) {
    case NAVIGATION_KEYS.arrowRight:
      return currentIndex >= last ? 0 : currentIndex + 1;
    case NAVIGATION_KEYS.arrowLeft:
      return currentIndex <= 0 ? last : currentIndex - 1;
    case NAVIGATION_KEYS.home:
      return 0;
    case NAVIGATION_KEYS.end:
      return last;
    default:
      return null;
  }
}

// One visible tree item, in display order.
export interface FlatTreeItem {
  readonly key: string;
  readonly parentIndex: number | null;
  readonly firstChildIndex: number | null;
  // An unopened, loadable document: ArrowRight opens it.
  readonly opensOnExpand: boolean;
  // Folders only: ArrowRight expands a collapsed one, ArrowLeft collapses an expanded one.
  readonly folderState: "expanded" | "collapsed" | null;
}

export type TreeNavigation =
  | { readonly action: "focus"; readonly index: number }
  | { readonly action: "open"; readonly index: number }
  | { readonly action: "expand"; readonly index: number }
  | { readonly action: "collapse"; readonly index: number };

// ArrowUp / ArrowDown / Home / End move between visible items. ArrowRight expands a
// collapsed folder, opens an unopened document, or else moves to the first child;
// ArrowLeft collapses an expanded folder, or else moves to the parent. Documents are never
// collapsed because closing a document saves it, which is not a navigation key's job.
export function treeNavigation(
  key: string,
  items: readonly FlatTreeItem[],
  currentIndex: number,
): TreeNavigation | null {
  const current = items[currentIndex];
  if (current === undefined) return null;
  switch (key) {
    case NAVIGATION_KEYS.arrowDown:
      return currentIndex < items.length - 1
        ? { action: "focus", index: currentIndex + 1 }
        : null;
    case NAVIGATION_KEYS.arrowUp:
      return currentIndex > 0
        ? { action: "focus", index: currentIndex - 1 }
        : null;
    case NAVIGATION_KEYS.home:
      return { action: "focus", index: 0 };
    case NAVIGATION_KEYS.end:
      return { action: "focus", index: items.length - 1 };
    case NAVIGATION_KEYS.arrowRight:
      if (current.folderState === "collapsed") {
        return { action: "expand", index: currentIndex };
      }
      if (current.opensOnExpand) return { action: "open", index: currentIndex };
      return current.firstChildIndex === null
        ? null
        : { action: "focus", index: current.firstChildIndex };
    case NAVIGATION_KEYS.arrowLeft:
      if (current.folderState === "expanded") {
        return { action: "collapse", index: currentIndex };
      }
      return current.parentIndex === null
        ? null
        : { action: "focus", index: current.parentIndex };
    default:
      return null;
  }
}
