import {
  type CSSProperties,
  type KeyboardEvent,
  type Ref,
  useEffect,
  useRef,
} from "react";

export interface PopupMenuItem {
  readonly id: string;
  readonly label: string;
  // Stays focusable (so it can be discovered) but does nothing when chosen.
  readonly disabled?: boolean;
  // Why the item is disabled (or a note about it): shown as a tooltip and exposed to
  // assistive technology as the item's description.
  readonly hint?: string;
  readonly onSelect: () => void;
}

// A divider between groups of items; not focusable and not chosen.
export interface PopupMenuSeparator {
  readonly id: string;
  readonly separator: true;
}

export type PopupMenuEntry = PopupMenuItem | PopupMenuSeparator;

export function isSeparator(
  entry: PopupMenuEntry,
): entry is PopupMenuSeparator {
  return "separator" in entry;
}

const KEYS = {
  escape: "Escape",
  arrowDown: "ArrowDown",
  arrowUp: "ArrowUp",
  home: "Home",
  end: "End",
} as const;

export interface MenuListProps {
  readonly label: string;
  readonly entries: readonly PopupMenuEntry[];
  // Escape: the owner closes the menu and puts focus back where it came from.
  readonly onDismiss: () => void;
  // An enabled item was chosen; the owner closes the menu before running it.
  readonly onChoose: (item: PopupMenuItem) => void;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly listRef?: Ref<HTMLDivElement>;
}

// The open list of a menu (WAI-ARIA menu pattern), shared by the menu button and the
// context menu: the first item gets focus when it appears; arrow keys and Home / End move
// (wrapping), Enter / click chooses, Escape dismisses.
export function MenuList({
  label,
  entries,
  onDismiss,
  onChoose,
  className,
  style,
  listRef,
}: MenuListProps) {
  const ownRef = useRef<HTMLDivElement | null>(null);

  function itemElements(): HTMLElement[] {
    return [
      ...(ownRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ??
        []),
    ];
  }

  function focusItem(index: number): void {
    const list = itemElements();
    list[(index + list.length) % list.length]?.focus();
  }

  useEffect(() => {
    ownRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const current = itemElements().indexOf(
      document.activeElement as HTMLElement,
    );
    switch (event.key) {
      case KEYS.escape:
        event.preventDefault();
        // The menu may sit inside something that also closes on Escape (a dialog).
        event.stopPropagation();
        onDismiss();
        return;
      case KEYS.arrowDown:
        event.preventDefault();
        focusItem(current + 1);
        return;
      case KEYS.arrowUp:
        event.preventDefault();
        focusItem(current - 1);
        return;
      case KEYS.home:
        event.preventDefault();
        focusItem(0);
        return;
      case KEYS.end:
        event.preventDefault();
        focusItem(itemElements().length - 1);
        return;
    }
  }

  return (
    <div
      ref={(element) => {
        ownRef.current = element;
        if (typeof listRef === "function") listRef(element);
        else if (listRef != null) listRef.current = element;
      }}
      role="menu"
      aria-label={label}
      className={["popup-menu__list", className].filter(Boolean).join(" ")}
      style={style}
      onKeyDown={onKeyDown}
    >
      {entries.map((entry) =>
        isSeparator(entry) ? (
          <hr key={entry.id} className="popup-menu__separator" />
        ) : (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            className="popup-menu__item"
            aria-disabled={entry.disabled === true ? true : undefined}
            aria-description={entry.hint}
            title={entry.hint}
            onClick={() => {
              if (entry.disabled === true) return;
              onChoose(entry);
            }}
          >
            {entry.label}
          </button>
        ),
      )}
    </div>
  );
}
