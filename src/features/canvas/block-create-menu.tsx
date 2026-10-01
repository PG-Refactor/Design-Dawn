import {
  type KeyboardEvent,
  type FocusEvent as ReactFocusEvent,
  useRef,
  useState,
} from "react";
import type { BlockType } from "../../domain/block/block-type";
import { CANVAS_MESSAGES } from "./canvas-messages";
import { CREATABLE_BLOCK_TYPES } from "./creatable-block-types";

export interface BlockCreateMenuProps {
  readonly onCreate: (blockType: BlockType) => void;
}

const KEYS = {
  escape: "Escape",
  arrowDown: "ArrowDown",
  arrowUp: "ArrowUp",
  home: "Home",
  end: "End",
} as const;

// The "+ Block" menu button (menu button pattern): the button opens a menu of the creatable
// block types; arrow keys move, Enter / click chooses, Escape closes and focus goes back to
// the button.
export function BlockCreateMenu({ onCreate }: BlockCreateMenuProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function items(): HTMLElement[] {
    return [
      ...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ??
        []),
    ];
  }

  function focusItem(index: number): void {
    const list = items();
    list[(index + list.length) % list.length]?.focus();
  }

  function close(): void {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function openMenu(): void {
    setOpen(true);
    // The menu is rendered by this state change; focus its first item right after.
    queueMicrotask(() => focusItem(0));
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = items();
    const current = list.indexOf(document.activeElement as HTMLElement);
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
        focusItem(list.length - 1);
        return;
    }
  }

  // Focus leaving the whole widget (Tab away, a click elsewhere) closes the menu without
  // pulling focus back.
  function onBlur(event: ReactFocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setOpen(false);
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only observes focus leaving the widget; it is not an interactive element.
    <div className="block-create-menu" onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        className="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === KEYS.arrowDown) {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        {CANVAS_MESSAGES.toolbar.addBlock}
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={CANVAS_MESSAGES.toolbar.blockTypeMenuLabel}
          className="block-create-menu__list"
          onKeyDown={onMenuKeyDown}
        >
          {CREATABLE_BLOCK_TYPES.map((creatable) => (
            <button
              key={creatable.blockType}
              type="button"
              role="menuitem"
              className="block-create-menu__item"
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
                onCreate(creatable.blockType);
              }}
            >
              {creatable.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
