import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from "react";
import { TreeRenameInput } from "./tree-rename-input";
import {
  type FlatTreeItem,
  NAVIGATION_KEYS,
  treeNavigation,
} from "./view-models/keyboard-navigation";
import type {
  MoveTarget,
  MoveTargetDisabledReason,
} from "./view-models/move-targets";
import { MESSAGES } from "./workspace-messages";
import "./project-tree.css";
import "./move-dialog.css";

const FOLD_MARKER_CLASS = "move-target__marker";

function disabledHint(reason: MoveTargetDisabledReason): string {
  switch (reason) {
    case "currentParent":
      return MESSAGES.dialogs.moveEntry.currentParentHint;
    case "selfOrDescendant":
      return MESSAGES.dialogs.moveEntry.selfOrDescendantHint;
    case "notLoaded":
      return MESSAGES.tree.loadFailedHint;
  }
}

function flatItemsOf(
  rows: readonly MoveTarget[],
  expandedKeys: ReadonlySet<string>,
): readonly FlatTreeItem[] {
  return rows.map((row, index) => {
    const parentIndex = rows.findIndex((other) => other.key === row.parentKey);
    return {
      key: row.key,
      parentIndex: parentIndex < 0 ? null : parentIndex,
      firstChildIndex:
        rows[index + 1]?.parentKey === row.key ? index + 1 : null,
      opensOnExpand: false,
      folderState: row.hasChildFolders
        ? expandedKeys.has(row.key)
          ? "expanded"
          : "collapsed"
        : null,
    };
  });
}

export interface MoveTargetTreeProps {
  // The rows that are shown (folded rows already left out), in display order.
  readonly rows: readonly MoveTarget[];
  readonly label: string;
  readonly highlightedKey: string;
  readonly expandedKeys: ReadonlySet<string>;
  // While set, an inline name input is shown as the first child of the row with this key.
  readonly creatingInKey: string | null;
  // Receives the row element of the initially highlighted row, so the dialog can focus it.
  readonly initialFocusRef: RefObject<HTMLElement | null>;
  readonly initialKey: string;
  // A key whose row should take focus once it exists (a folder that was just created).
  readonly focusKey: string | null;
  readonly onHighlight: (key: string) => void;
  readonly onSetExpanded: (key: string, expanded: boolean) => void;
  // Enter / double-click on a row. The caller ignores rows that cannot be chosen.
  readonly onChoose: (target: MoveTarget) => void;
  readonly onCreateFolder: (name: string, parentFolderKey: string) => void;
  readonly onCancelCreate: () => void;
}

// The folder tree of the move dialog: the look of the Project Tree (the same row classes),
// a flat list with `aria-level` because the rows are filtered by folding, not nested.
export function MoveTargetTree({
  rows,
  label,
  highlightedKey,
  expandedKeys,
  creatingInKey,
  initialFocusRef,
  initialKey,
  focusKey,
  onHighlight,
  onSetExpanded,
  onChoose,
  onCreateFolder,
  onCancelCreate,
}: MoveTargetTreeProps) {
  const elements = useRef(new Map<string, HTMLLIElement>());
  const idPrefix = useId();

  // Focus moves only after the row exists (the new folder appears with the next render).
  useEffect(() => {
    if (focusKey !== null) elements.current.get(focusKey)?.focus();
  }, [focusKey]);

  function handleKeyDown(
    event: KeyboardEvent<HTMLLIElement>,
    row: MoveTarget,
    index: number,
  ): void {
    if (event.target !== event.currentTarget) return;
    if (event.key === NAVIGATION_KEYS.enter) {
      event.preventDefault();
      onChoose(row);
      return;
    }
    const navigation = treeNavigation(
      event.key,
      flatItemsOf(rows, expandedKeys),
      index,
    );
    if (navigation === null) return;
    event.preventDefault();
    const target = rows[navigation.index];
    if (target === undefined) return;
    if (navigation.action === "focus") {
      elements.current.get(target.key)?.focus();
    } else if (navigation.action === "expand") {
      onSetExpanded(target.key, true);
    } else if (navigation.action === "collapse") {
      onSetExpanded(target.key, false);
    }
  }

  function handleClick(
    event: MouseEvent<HTMLLIElement>,
    row: MoveTarget,
  ): void {
    event.currentTarget.focus();
    const target = event.target;
    if (
      row.hasChildFolders &&
      target instanceof Element &&
      target.closest(`.${FOLD_MARKER_CLASS}`) !== null
    ) {
      onSetExpanded(row.key, !expandedKeys.has(row.key));
    }
  }

  return (
    <ul
      className="project-tree move-dialog__tree"
      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the ARIA tree pattern puts role="tree" on a list.
      role="tree"
      aria-label={label}
    >
      {rows.flatMap((row, index) => {
        const reason = row.disabledReason;
        const hint = reason === null ? undefined : disabledHint(reason);
        const selected = row.key === highlightedKey;
        const expanded = expandedKeys.has(row.key);
        const itemClass = [
          "tree-item",
          "move-dialog__item",
          selected ? "tree-item--selected" : "",
          reason === null ? "" : "move-dialog__item--disabled",
        ]
          .filter((name) => name !== "")
          .join(" ");
        const depthStyle = {
          "--move-dialog-depth": row.depth,
        } as CSSProperties;
        const item = (
          <li
            key={row.key}
            ref={(element) => {
              if (element === null) {
                elements.current.delete(row.key);
                return;
              }
              elements.current.set(row.key, element);
              if (row.key === initialKey) initialFocusRef.current = element;
            }}
            role="treeitem"
            aria-labelledby={`${idPrefix}-${row.key}`}
            aria-selected={selected}
            aria-expanded={row.hasChildFolders ? expanded : undefined}
            aria-level={row.depth + 1}
            aria-disabled={reason === null ? undefined : true}
            aria-description={hint}
            title={hint}
            tabIndex={selected ? 0 : -1}
            className={itemClass}
            style={depthStyle}
            onClick={(event) => handleClick(event, row)}
            onDoubleClick={() => onChoose(row)}
            onKeyDown={(event) => handleKeyDown(event, row, index)}
            onFocus={(event) => {
              if (event.target === event.currentTarget) onHighlight(row.key);
            }}
          >
            <div className="tree-item__row">
              <span
                className={`tree-item__folder-marker ${FOLD_MARKER_CLASS}`}
                aria-hidden="true"
              >
                {row.hasChildFolders
                  ? expanded
                    ? MESSAGES.tree.folderExpandedMarker
                    : MESSAGES.tree.folderCollapsedMarker
                  : ""}
              </span>
              <span id={`${idPrefix}-${row.key}`} className="tree-item__label">
                {row.name}
              </span>
            </div>
          </li>
        );
        if (creatingInKey !== row.key) return [item];
        return [
          item,
          <li
            key={`${row.key}-new-folder`}
            role="none"
            className="move-dialog__item"
            style={{ "--move-dialog-depth": row.depth + 1 } as CSSProperties}
          >
            <div className="tree-item__row">
              <TreeRenameInput
                initialName=""
                label={MESSAGES.dialogs.moveEntry.newFolderInputLabel}
                onSubmit={(name) => onCreateFolder(name, row.key)}
                onCancel={onCancelCreate}
                restoreFocus={() => elements.current.get(row.key)?.focus()}
              />
            </div>
          </li>,
        ];
      })}
    </ul>
  );
}
