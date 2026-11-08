// The rows chosen in the Project Tree, and how clicks and keys change them (as in VS Code's
// Explorer): a plain click chooses one row, Ctrl/Cmd adds or removes one, Shift chooses the
// range from the anchor. Pure; the rows are tree keys (`tree-items.ts`).

export interface TreeSelection {
  // The chosen rows, in the order they were chosen.
  readonly keys: readonly string[];
  // Where a Shift range starts: the row last chosen by a plain or Ctrl/Cmd click.
  readonly anchorKey: string | null;
  // The row chosen last: new entries go there, and the keyboard starts from it.
  readonly activeKey: string | null;
}

export const EMPTY_TREE_SELECTION: TreeSelection = {
  keys: [],
  anchorKey: null,
  activeKey: null,
};

export function selectOnly(key: string): TreeSelection {
  return { keys: [key], anchorKey: key, activeKey: key };
}

export function toggleSelected(
  selection: TreeSelection,
  key: string,
): TreeSelection {
  if (!selection.keys.includes(key)) {
    return { keys: [...selection.keys, key], anchorKey: key, activeKey: key };
  }
  const keys = selection.keys.filter((candidate) => candidate !== key);
  return { keys, anchorKey: key, activeKey: keys.at(-1) ?? null };
}

// The rows from the anchor to `key`, in display order (`visibleKeys`). Without an anchor
// (or one that is no longer shown) the range is `key` alone, which becomes the anchor.
export function selectRange(
  selection: TreeSelection,
  key: string,
  visibleKeys: readonly string[],
): TreeSelection {
  const to = visibleKeys.indexOf(key);
  const anchor =
    selection.anchorKey !== null && visibleKeys.includes(selection.anchorKey)
      ? selection.anchorKey
      : key;
  const from = visibleKeys.indexOf(anchor);
  if (to < 0 || from < 0) return selectOnly(key);
  const [start, end] = from <= to ? [from, to] : [to, from];
  return {
    keys: visibleKeys.slice(start, end + 1),
    anchorKey: anchor,
    activeKey: key,
  };
}

// Only the rows that are still shown (deleted rows and rows inside a folded folder drop
// out); an active row that dropped out is no longer active.
export function visibleSelection(
  selection: TreeSelection,
  visibleKeys: readonly string[],
): TreeSelection {
  const shown = new Set(visibleKeys);
  const keys = selection.keys.filter((key) => shown.has(key));
  if (keys.length === selection.keys.length) return selection;
  return {
    keys,
    anchorKey:
      selection.anchorKey !== null && shown.has(selection.anchorKey)
        ? selection.anchorKey
        : null,
    activeKey:
      selection.activeKey !== null && shown.has(selection.activeKey)
        ? selection.activeKey
        : null,
  };
}
