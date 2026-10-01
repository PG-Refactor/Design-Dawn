import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useId,
} from "react";
import { FOCUS_FALLBACK_ATTRIBUTE } from "./focus-utils";
import { NAVIGATION_KEYS } from "./view-models/keyboard-navigation";
import { MESSAGES } from "./workspace-messages";

export interface TreeItemAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface TreeItemProps {
  readonly itemKey: string;
  readonly label: string;
  // The one item that is a tab stop; the others are reached with the arrow keys.
  readonly isRoving: boolean;
  readonly selected?: boolean;
  readonly expanded?: boolean;
  // Failed to load: shown with a text marker, cannot be activated.
  readonly failed?: boolean;
  readonly register: (key: string, element: HTMLLIElement | null) => void;
  readonly onFocusItem: (key: string) => void;
  readonly onNavigate: (
    event: KeyboardEvent<HTMLLIElement>,
    key: string,
  ) => void;
  readonly onActivate?: () => void;
  readonly actions: readonly TreeItemAction[];
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
  failed = false,
  register,
  onFocusItem,
  onNavigate,
  onActivate,
  actions,
  children,
}: TreeItemProps) {
  const labelId = useId();
  const markerId = useId();

  function handleClick(event: MouseEvent<HTMLLIElement>): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    // Buttons and nested items handle their own clicks.
    if (target.closest("button") !== null) return;
    if (target.closest('[role="treeitem"]') !== event.currentTarget) return;
    event.currentTarget.focus();
    onActivate?.();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLLIElement>): void {
    // Keys pressed in an action button or a nested item belong to that element.
    if (event.target !== event.currentTarget) return;
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
      ref={(element) => register(itemKey, element)}
      role="treeitem"
      aria-labelledby={failed ? `${labelId} ${markerId}` : labelId}
      aria-selected={selected}
      aria-expanded={expanded}
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
        <span id={labelId} className="tree-item__label">
          {label}
        </span>
        {failed ? (
          <span
            id={markerId}
            className="tree-item__marker"
            title={MESSAGES.tree.loadFailedHint}
          >
            {`⚠ ${MESSAGES.tree.loadFailedMarker}`}
          </span>
        ) : null}
        <span className="tree-item__actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="tree-item__action"
              tabIndex={isRoving ? 0 : -1}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </span>
      </div>
      {children}
    </li>
  );
}
