import {
  type KeyboardEvent,
  type FocusEvent as ReactFocusEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import "./popup-menu.css";

export interface PopupMenuItem {
  readonly id: string;
  readonly label: string;
  // Stays focusable (so it can be discovered) but does nothing when chosen.
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

export interface PopupMenuProps {
  // Accessible name of the trigger button; `triggerContent` is only its visible glyph.
  readonly triggerLabel: string;
  readonly triggerContent: ReactNode;
  readonly menuLabel: string;
  readonly items: readonly PopupMenuItem[];
  // Lets a roving-tabindex host (the tree) keep the trigger out of the Tab order.
  readonly triggerTabIndex?: number;
  readonly className?: string;
}

const KEYS = {
  escape: "Escape",
  arrowDown: "ArrowDown",
  arrowUp: "ArrowUp",
  home: "Home",
  end: "End",
} as const;

// A menu button (WAI-ARIA menu button pattern): the trigger opens a menu; arrow keys,
// Home / End move, Enter / click chooses, Escape closes and focus goes back to the
// trigger, and focus leaving the widget closes it without pulling focus back.
export function PopupMenu({
  triggerLabel,
  triggerContent,
  menuLabel,
  items,
  triggerTabIndex,
  className,
}: PopupMenuProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function itemElements(): HTMLElement[] {
    return [
      ...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ??
        []),
    ];
  }

  function focusItem(index: number): void {
    const list = itemElements();
    list[(index + list.length) % list.length]?.focus();
  }

  // The menu is rendered by the state change, so its first item is focused afterwards.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  function close(): void {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const current = itemElements().indexOf(
      document.activeElement as HTMLElement,
    );
    switch (event.key) {
      case KEYS.escape:
        event.preventDefault();
        close();
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

  function onBlur(event: ReactFocusEvent<HTMLDivElement>): void {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setOpen(false);
  }

  function choose(item: PopupMenuItem): void {
    if (item.disabled === true) return;
    // Focus goes back first, so what the action opens (a dialog) remembers the trigger.
    setOpen(false);
    buttonRef.current?.focus();
    item.onSelect();
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only observes focus leaving the widget; it is not an interactive element.
    <div
      className={["popup-menu", className].filter(Boolean).join(" ")}
      onBlur={onBlur}
    >
      <button
        ref={buttonRef}
        type="button"
        className="popup-menu__trigger"
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        tabIndex={triggerTabIndex}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        onKeyDown={(event) => {
          if (event.key === KEYS.arrowDown) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {triggerContent}
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={menuLabel}
          className="popup-menu__list"
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="popup-menu__item"
              aria-disabled={item.disabled === true ? true : undefined}
              onClick={() => choose(item)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
