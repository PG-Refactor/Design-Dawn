import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useId,
  useRef,
} from "react";
import {
  PopupMenu,
  type PopupMenuEntry,
  type PopupMenuItem,
} from "../../shared/menu/popup-menu";
import { FOCUS_FALLBACK_ATTRIBUTE } from "./focus-utils";
import { TreeRenameInput } from "./tree-rename-input";
import { useMessages } from "./use-messages";
import type { TreeRowPointerHandlers } from "./use-tree-drag";
import { NAVIGATION_KEYS } from "./view-models/keyboard-navigation";
import { MOVE_DIRECTIONS, type MoveDirection } from "./view-models/reorder";
import type { TreeDropPosition } from "./view-models/tree-drag";

// Present while this row's name is being edited.
export interface TreeItemRenaming {
  readonly onSubmit: (name: string) => void;
  readonly onCancel: () => void;
}

const RENAME_KEY = "F2";
const SINGLE_CLICK_DETAIL = 1;

export interface TreeItemProps {
  readonly itemKey: string;
  readonly label: string;
  // The one item that is a tab stop; the others are reached with the arrow keys.
  readonly isRoving: boolean;
  readonly selected?: boolean;
  readonly expanded?: boolean;
  // Nesting depth for assistive technology (the Project is 1).
  readonly level?: number;
  // A decorative glyph before the name (the fold state of a folder). Not part of the
  // accessible name, which `aria-expanded` already covers.
  readonly leadingMarker?: string;
  // Tells folders from documents at a glance. Decorative, like the marker; with an icon
  // the marker's place is kept even when there is no marker, so the icons line up.
  readonly icon?: ReactNode;
  // Failed to load: shown with a text marker, cannot be activated.
  readonly failed?: boolean;
  readonly register: (key: string, element: HTMLLIElement | null) => void;
  // A click (plain, Ctrl/Cmd or Shift) or right-click chooses the row.
  readonly onChoose?: (mode: TreeChooseMode) => void;
  readonly onNavigate: (
    event: KeyboardEvent<HTMLLIElement>,
    key: string,
  ) => void;
  readonly onActivate?: () => void;
  // Starts the inline rename (F2, the menu). Undefined: the row cannot be renamed.
  readonly onRename?: () => void;
  // A second click on this row while it is selected renames it (the active Document's
  // row); otherwise every click activates.
  readonly renameOnReclick?: boolean;
  // Dragging the row moves the entry. Undefined: the row cannot be dragged.
  readonly dragHandlers?: TreeRowPointerHandlers;
  // Where a drop now would put the dragged entry relative to this row; drawn on the row.
  readonly dropMarker?: TreeDropPosition | null;
  // The row is the one being dragged.
  readonly dragged?: boolean;
  // True for a click the row must ignore (the end of a drag).
  readonly ignoreClick?: () => boolean;
  // Ctrl/Cmd+ArrowUp / ArrowDown. Undefined: the row cannot be moved.
  readonly onMove?: (direction: MoveDirection) => void;
  readonly renaming?: TreeItemRenaming;
  readonly menuItems: readonly PopupMenuItem[];
  // The right-click menu: the "⋮" menu, or more where the row offers more (a document
  // also creates next to itself).
  readonly contextMenuItems?: readonly PopupMenuEntry[];
  readonly onContextMenu: TreeContextMenuHandler;
  readonly children?: ReactNode;
}

// How a pointer action chooses a row: alone (a plain click), added or removed (Ctrl/Cmd),
// the range from the anchor (Shift), or for its right-click menu.
export type TreeChooseMode = "replace" | "toggle" | "range" | "context";

export type TreeContextMenuHandler = (
  event: MouseEvent,
  label: string,
  entries: readonly PopupMenuEntry[],
  anchorElement: Element | null,
) => void;

function classNames(
  selected: boolean,
  failed: boolean,
  dragged: boolean,
  dropMarker: TreeDropPosition | null,
): string {
  return [
    "tree-item",
    selected ? "tree-item--selected" : "",
    failed ? "tree-item--failed" : "",
    dragged ? "tree-item--dragged" : "",
    dropMarker === null ? "" : `tree-item--drop-${dropMarker}`,
  ]
    .filter((name) => name !== "")
    .join(" ");
}

// One node of the tree. The treeitem is labelled by its own label only, so the nested
// items and the action buttons do not become part of its accessible name.
export function TreeItem({
  itemKey,
  label,
  isRoving,
  selected,
  expanded,
  level,
  leadingMarker,
  icon,
  failed = false,
  register,
  onChoose,
  onNavigate,
  onActivate,
  onRename,
  renameOnReclick = false,
  dragHandlers,
  dropMarker = null,
  dragged = false,
  ignoreClick,
  onMove,
  renaming,
  menuItems,
  contextMenuItems,
  onContextMenu,
  children,
}: TreeItemProps) {
  const messages = useMessages().workspace;
  const labelId = useId();
  const markerId = useId();
  const itemElement = useRef<HTMLLIElement | null>(null);
  const rowElement = useRef<HTMLDivElement | null>(null);

  function handleContextMenu(event: MouseEvent<HTMLLIElement>): void {
    // The rename input keeps the webview's text menu (cut / copy / paste).
    if (event.target instanceof Element && event.target.closest("input")) {
      return;
    }
    // The row the menu is for becomes the focused one, and chosen unless it already is.
    event.currentTarget.focus({ preventScroll: true });
    onChoose?.("context");
    onContextMenu(
      event,
      messages.treeMenuLabel(label),
      contextMenuItems ?? menuItems,
      rowElement.current,
    );
  }

  function handleClick(event: MouseEvent<HTMLLIElement>): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    // Buttons and nested items handle their own clicks.
    if (target.closest("button, input") !== null) return;
    if (target.closest('[role="treeitem"]') !== event.currentTarget) return;
    if (renaming !== undefined) return;
    if (ignoreClick?.() === true) return;
    event.currentTarget.focus();
    const mode: TreeChooseMode = event.shiftKey
      ? "range"
      : event.ctrlKey || event.metaKey
        ? "toggle"
        : "replace";
    onChoose?.(mode);
    // Ctrl/Cmd and Shift only change which rows are chosen: nothing opens or folds.
    if (mode !== "replace") return;
    // A second click on the row that is already selected renames it. The second half of
    // a double-click (detail > 1) is not that: it is the user hurrying, not asking.
    if (
      renameOnReclick &&
      selected === true &&
      onRename !== undefined &&
      event.detail <= SINGLE_CLICK_DETAIL
    ) {
      onRename();
      return;
    }
    onActivate?.();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLLIElement>): void {
    // Keys pressed in an action button or a nested item belong to that element.
    if (event.target !== event.currentTarget) return;
    if (event.key === RENAME_KEY) {
      if (onRename === undefined) return;
      event.preventDefault();
      onRename();
      return;
    }
    // Ctrl/Cmd+Arrow moves the entry; it must not fall through to focus navigation.
    if (
      (event.ctrlKey || event.metaKey) &&
      (event.key === NAVIGATION_KEYS.arrowUp ||
        event.key === NAVIGATION_KEYS.arrowDown)
    ) {
      event.preventDefault();
      onMove?.(
        event.key === NAVIGATION_KEYS.arrowUp
          ? MOVE_DIRECTIONS.up
          : MOVE_DIRECTIONS.down,
      );
      return;
    }
    if (
      event.key === NAVIGATION_KEYS.enter ||
      event.key === NAVIGATION_KEYS.space
    ) {
      event.preventDefault();
      onActivate?.();
      return;
    }
    onNavigate(event, itemKey);
  }

  const fallbackProps = isRoving
    ? { [FOCUS_FALLBACK_ATTRIBUTE]: "true" }
    : undefined;

  return (
    <li
      ref={(element) => {
        itemElement.current = element;
        register(itemKey, element);
      }}
      role="treeitem"
      aria-labelledby={failed ? `${labelId} ${markerId}` : labelId}
      aria-selected={selected}
      aria-expanded={expanded}
      aria-level={level}
      aria-disabled={failed ? true : undefined}
      tabIndex={isRoving ? 0 : -1}
      className={classNames(selected === true, failed, dragged, dropMarker)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
      {...fallbackProps}
    >
      <div ref={rowElement} className="tree-item__row" {...dragHandlers}>
        {leadingMarker === undefined && icon === undefined ? null : (
          <span className="tree-item__folder-marker" aria-hidden="true">
            {leadingMarker}
          </span>
        )}
        {icon === undefined ? null : (
          <span className="tree-item__icon">{icon}</span>
        )}
        <span
          id={labelId}
          className={
            renaming === undefined
              ? "tree-item__label"
              : "tree-item__label tree-item__label--hidden"
          }
        >
          {label}
        </span>
        {renaming === undefined ? null : (
          <TreeRenameInput
            initialName={label}
            label={messages.renameInputLabel(label)}
            onSubmit={renaming.onSubmit}
            onCancel={renaming.onCancel}
            restoreFocus={() => itemElement.current?.focus()}
          />
        )}
        {failed ? (
          <span
            id={markerId}
            className="tree-item__marker"
            title={messages.tree.loadFailedHint}
          >
            {`⚠ ${messages.tree.loadFailedMarker}`}
          </span>
        ) : null}
        <PopupMenu
          className="tree-item__menu"
          triggerLabel={messages.treeMenuLabel(label)}
          triggerContent={messages.tree.menuButtonText}
          menuLabel={messages.treeMenuLabel(label)}
          items={menuItems}
          triggerTabIndex={isRoving ? 0 : -1}
        />
      </div>
      {children}
    </li>
  );
}
