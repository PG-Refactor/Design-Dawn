import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useId,
  useRef,
} from "react";
import { PopupMenu, type PopupMenuItem } from "../../shared/menu/popup-menu";
import { FOCUS_FALLBACK_ATTRIBUTE } from "./focus-utils";
import { TreeRenameInput } from "./tree-rename-input";
import { useMessages } from "./use-messages";
import { NAVIGATION_KEYS } from "./view-models/keyboard-navigation";
import { MOVE_DIRECTIONS, type MoveDirection } from "./view-models/reorder";

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
  readonly onFocusItem: (key: string) => void;
  readonly onNavigate: (
    event: KeyboardEvent<HTMLLIElement>,
    key: string,
  ) => void;
  readonly onActivate?: () => void;
  // Starts the inline rename (F2, a second click on the selected row). Undefined: the
  // row cannot be renamed.
  readonly onRename?: () => void;
  // Ctrl/Cmd+ArrowUp / ArrowDown. Undefined: the row cannot be moved.
  readonly onMove?: (direction: MoveDirection) => void;
  readonly renaming?: TreeItemRenaming;
  readonly menuItems: readonly PopupMenuItem[];
  readonly children?: ReactNode;
}

function classNames(selected: boolean, failed: boolean): string {
  return [
    "tree-item",
    selected ? "tree-item--selected" : "",
    failed ? "tree-item--failed" : "",
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
  onFocusItem,
  onNavigate,
  onActivate,
  onRename,
  onMove,
  renaming,
  menuItems,
  children,
}: TreeItemProps) {
  const messages = useMessages().workspace;
  const labelId = useId();
  const markerId = useId();
  const itemElement = useRef<HTMLLIElement | null>(null);

  function handleClick(event: MouseEvent<HTMLLIElement>): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    // Buttons and nested items handle their own clicks.
    if (target.closest("button, input") !== null) return;
    if (target.closest('[role="treeitem"]') !== event.currentTarget) return;
    if (renaming !== undefined) return;
    event.currentTarget.focus();
    // A second click on the row that is already selected renames it. The second half of
    // a double-click (detail > 1) is not that: it is the user hurrying, not asking.
    if (
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
      className={classNames(selected === true, failed)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onFocus={(event) => {
        if (event.target === event.currentTarget) onFocusItem(itemKey);
      }}
      {...fallbackProps}
    >
      <div className="tree-item__row">
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
