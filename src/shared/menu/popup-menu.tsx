import {
  type FocusEvent as ReactFocusEvent,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { MenuList, type PopupMenuEntry, type PopupMenuItem } from "./menu-list";
import "./popup-menu.css";

export type {
  PopupMenuEntry,
  PopupMenuItem,
  PopupMenuSeparator,
} from "./menu-list";

export interface PopupMenuProps {
  // Accessible name of the trigger button; `triggerContent` is only its visible glyph.
  readonly triggerLabel: string;
  readonly triggerContent: ReactNode;
  readonly menuLabel: string;
  readonly items: readonly PopupMenuEntry[];
  // Lets a roving-tabindex host (the tree) keep the trigger out of the Tab order.
  readonly triggerTabIndex?: number;
  readonly className?: string;
}

const OPEN_KEY = "ArrowDown";

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

  function close(): void {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onBlur(event: ReactFocusEvent<HTMLDivElement>): void {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setOpen(false);
  }

  function choose(item: PopupMenuItem): void {
    // Focus goes back first, so what the action opens (a dialog) remembers the trigger.
    close();
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
          if (event.key === OPEN_KEY) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {triggerContent}
      </button>
      {open && (
        <MenuList
          label={menuLabel}
          entries={items}
          onDismiss={close}
          onChoose={choose}
        />
      )}
    </div>
  );
}
