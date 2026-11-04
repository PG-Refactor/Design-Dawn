import {
  type CSSProperties,
  type KeyboardEvent,
  type Ref,
  useEffect,
  useRef,
  useState,
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

// An item that opens a nested menu beside it (a group of rarely needed items kept out of
// the way, such as the templates).
export interface PopupMenuSubmenu {
  readonly id: string;
  readonly label: string;
  readonly entries: readonly PopupMenuEntry[];
}

export type PopupMenuEntry =
  | PopupMenuItem
  | PopupMenuSeparator
  | PopupMenuSubmenu;

export function isSeparator(
  entry: PopupMenuEntry,
): entry is PopupMenuSeparator {
  return "separator" in entry;
}

export function isSubmenu(entry: PopupMenuEntry): entry is PopupMenuSubmenu {
  return "entries" in entry;
}

const KEYS = {
  escape: "Escape",
  arrowDown: "ArrowDown",
  arrowUp: "ArrowUp",
  arrowRight: "ArrowRight",
  arrowLeft: "ArrowLeft",
  home: "Home",
  end: "End",
} as const;

// The items of this list only, not those of a nested menu inside it.
const OWN_ITEMS =
  ':scope > [role="menuitem"], :scope > .popup-menu__submenu > [role="menuitem"]';

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
  // A nested menu: ArrowLeft goes back to the item that opened it, like Escape.
  readonly nested?: boolean;
}

// The open list of a menu (WAI-ARIA menu pattern), shared by the menu button and the
// context menu: the first item gets focus when it appears; arrow keys and Home / End move
// (wrapping), Enter / click chooses, Escape dismisses. A submenu item opens its menu beside
// it on click, ArrowRight or hover; Escape or ArrowLeft there goes back to the item.
export function MenuList({
  label,
  entries,
  onDismiss,
  onChoose,
  className,
  style,
  listRef,
  nested = false,
}: MenuListProps) {
  const ownRef = useRef<HTMLDivElement | null>(null);
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  const submenuItemRefs = useRef(new Map<string, HTMLButtonElement>());

  function itemElements(): HTMLElement[] {
    return [
      ...(ownRef.current?.querySelectorAll<HTMLElement>(OWN_ITEMS) ?? []),
    ];
  }

  function focusItem(index: number): void {
    const list = itemElements();
    list[(index + list.length) % list.length]?.focus();
  }

  useEffect(() => {
    ownRef.current?.querySelector<HTMLElement>(OWN_ITEMS)?.focus();
  }, []);

  function closeSubmenu(id: string): void {
    setOpenSubmenuId(null);
    submenuItemRefs.current.get(id)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const own = itemElements();
    const current = own.indexOf(document.activeElement as HTMLElement);
    // Keys pressed inside an open submenu are its own (it handles them and stops them).
    if (current === -1 && openSubmenuId !== null) return;
    const handled = (): void => {
      event.preventDefault();
      // The menu may sit inside something that also uses these keys (a dialog, an outer
      // menu).
      event.stopPropagation();
    };
    switch (event.key) {
      case KEYS.escape:
        handled();
        onDismiss();
        return;
      case KEYS.arrowLeft:
        if (!nested) return;
        handled();
        onDismiss();
        return;
      case KEYS.arrowDown:
        handled();
        focusItem(current + 1);
        return;
      case KEYS.arrowUp:
        handled();
        focusItem(current - 1);
        return;
      case KEYS.home:
        handled();
        focusItem(0);
        return;
      case KEYS.end:
        handled();
        focusItem(own.length - 1);
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
      {entries.map((entry) => {
        if (isSeparator(entry)) {
          return <hr key={entry.id} className="popup-menu__separator" />;
        }
        if (isSubmenu(entry)) {
          const open = openSubmenuId === entry.id;
          return (
            <div key={entry.id} className="popup-menu__submenu">
              <button
                ref={(element) => {
                  if (element === null)
                    submenuItemRefs.current.delete(entry.id);
                  else submenuItemRefs.current.set(entry.id, element);
                }}
                type="button"
                role="menuitem"
                className="popup-menu__item popup-menu__item--submenu"
                aria-haspopup="menu"
                aria-expanded={open}
                // Opens, never toggles: the pointer reaching the item already opened it.
                onClick={() => setOpenSubmenuId(entry.id)}
                onPointerEnter={() => setOpenSubmenuId(entry.id)}
                onKeyDown={(event) => {
                  if (event.key !== KEYS.arrowRight) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setOpenSubmenuId(entry.id);
                }}
              >
                <span>{entry.label}</span>
                <span aria-hidden="true" className="popup-menu__submenu-marker">
                  ▸
                </span>
              </button>
              {open && (
                <MenuList
                  label={entry.label}
                  entries={entry.entries}
                  onDismiss={() => closeSubmenu(entry.id)}
                  onChoose={onChoose}
                  className="popup-menu__list--nested"
                  nested
                />
              )}
            </div>
          );
        }
        return (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            className="popup-menu__item"
            aria-disabled={entry.disabled === true ? true : undefined}
            aria-description={entry.hint}
            title={entry.hint}
            // Moving to another item closes an open submenu, like a desktop menu.
            onPointerEnter={() => setOpenSubmenuId(null)}
            onClick={() => {
              if (entry.disabled === true) return;
              onChoose(entry);
            }}
          >
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}
