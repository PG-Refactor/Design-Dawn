import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type {
  MenuActionItem,
  MenuDefinition,
  MenuEntry,
  MenuRadioGroup,
  MenuSeparator,
  MenuSubmenu,
} from "./menu-bar-types";
import "./menu-bar.css";

// An in-webview menu bar rather than the OS native menu: the menus must use the theme
// tokens, follow the display language chosen in the app, and be testable in the DOM, none
// of which a native menu allows. Behaviour follows the WAI-ARIA menubar pattern.

const MENU_ITEM_SELECTOR =
  '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]';
const MENUBAR_SHORTCUT_KEY = "F10";

// Where the focus goes after a menu opens: an item, or stay on the title.
type FocusTarget = "first" | "last" | "trigger";

interface OpenState {
  readonly menuIndex: number;
  readonly focus: FocusTarget;
}

const MENU_SELECTOR = '[role="menu"]';
const SUBMENU_SELECTOR = ".menu-bar__submenu";

// The items of this menu, not those of a submenu inside it.
function itemsOf(menu: HTMLElement | null): HTMLElement[] {
  return menu === null
    ? []
    : [...menu.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)].filter(
        (item) => item.parentElement?.closest(MENU_SELECTOR) === menu,
      );
}

type ActivateHandler = (select: () => void, disabled: boolean) => void;

// Enter and Space on the focused item are handled here (not on the menu) so every item
// is operable by keyboard on its own.
function onItemKeyDown(event: KeyboardEvent, activate: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
}

function ActionItemView({
  entry,
  onActivate,
}: {
  readonly entry: MenuActionItem | MenuSeparator;
  readonly onActivate: ActivateHandler;
}) {
  if (entry.kind === "separator") return <hr className="menu-bar__separator" />;
  const activate = () => onActivate(entry.onSelect, entry.disabled === true);
  return (
    <div
      role="menuitem"
      tabIndex={-1}
      className="menu-bar__item"
      aria-disabled={entry.disabled === true ? true : undefined}
      aria-keyshortcuts={entry.shortcutKeys}
      onClick={activate}
      onKeyDown={(event) => onItemKeyDown(event, activate)}
    >
      <span>{entry.label}</span>
      {entry.shortcutHint === undefined ? null : (
        <span className="menu-bar__shortcut" aria-hidden="true">
          {entry.shortcutHint}
        </span>
      )}
    </div>
  );
}

// The nested menu opens on hover, click, Enter, Space or the right arrow, and its keys
// stay inside it: up / down move, left and Escape go back to its item.
function SubmenuView({
  entry,
  onActivate,
  open,
  setOpen,
}: {
  readonly entry: MenuSubmenu;
  readonly onActivate: ActivateHandler;
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
}) {
  const [focusFirst, setFocusFirst] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open || !focusFirst) return;
    itemsOf(menuRef.current)[0]?.focus();
    setFocusFirst(false);
  }, [open, focusFirst]);

  const openWithFocus = () => {
    setOpen(true);
    setFocusFirst(true);
  };
  const closeToTrigger = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (event: KeyboardEvent) => {
    if (
      event.key !== "Enter" &&
      event.key !== " " &&
      event.key !== "ArrowRight"
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    openWithFocus();
  };

  const onMenuKeyDown = (event: KeyboardEvent) => {
    const items = itemsOf(menuRef.current);
    const current = items.indexOf(document.activeElement as HTMLElement);
    const moveTo = (target: number) =>
      items[(target + items.length) % items.length]?.focus();
    switch (event.key) {
      case "ArrowDown":
        moveTo(current + 1);
        break;
      case "ArrowUp":
        moveTo(current < 0 ? -1 : current - 1);
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(-1);
        break;
      case "ArrowLeft":
      case "Escape":
        closeToTrigger();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      role="none"
      className="menu-bar__submenu"
      onMouseEnter={() => setOpen(true)}
    >
      <div
        ref={triggerRef}
        role="menuitem"
        tabIndex={-1}
        className="menu-bar__item"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={openWithFocus}
        onKeyDown={onTriggerKeyDown}
      >
        <span>{entry.label}</span>
        <span className="menu-bar__shortcut" aria-hidden="true">
          ▸
        </span>
      </div>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={entry.label}
          className="menu-bar__popup menu-bar__popup--nested"
          onKeyDown={onMenuKeyDown}
        >
          {entry.entries.map((child) => (
            <ActionItemView
              key={child.id}
              entry={child}
              onActivate={onActivate}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Which submenu of the open menu is open (by entry id), shared by its entries so that
// moving to another entry closes it, as in a desktop menu.
interface SubmenuState {
  readonly openId: string | null;
  readonly setOpenId: (id: string | null) => void;
}

function MenuEntryView({
  entry,
  onActivate,
  submenu,
}: {
  readonly entry: MenuEntry;
  readonly onActivate: ActivateHandler;
  readonly submenu: SubmenuState;
}) {
  switch (entry.kind) {
    case "separator":
    case "item":
      return <ActionItemView entry={entry} onActivate={onActivate} />;
    case "submenu":
      return (
        <SubmenuView
          entry={entry}
          onActivate={onActivate}
          open={submenu.openId === entry.id}
          setOpen={(open) => submenu.setOpenId(open ? entry.id : null)}
        />
      );
    case "checkbox": {
      const activate = () =>
        onActivate(entry.onSelect, entry.disabled === true);
      return (
        <div
          role="menuitemcheckbox"
          tabIndex={-1}
          className="menu-bar__item"
          aria-checked={entry.checked}
          aria-disabled={entry.disabled === true ? true : undefined}
          onClick={activate}
          onKeyDown={(event) => onItemKeyDown(event, activate)}
        >
          <span>{entry.label}</span>
        </div>
      );
    }
    case "radioGroup":
      return <RadioGroupView group={entry} onActivate={onActivate} />;
  }
}

function RadioGroupView({
  group,
  onActivate,
}: {
  readonly group: MenuRadioGroup;
  readonly onActivate: ActivateHandler;
}) {
  return (
    <fieldset className="menu-bar__group">
      <legend className="menu-bar__group-label">{group.label}</legend>
      {group.options.map((option) => {
        const activate = () =>
          onActivate(
            () => group.onSelect(option.value),
            group.disabled === true,
          );
        return (
          <div
            key={option.value}
            role="menuitemradio"
            tabIndex={-1}
            className="menu-bar__item"
            aria-checked={option.value === group.value}
            aria-disabled={group.disabled === true ? true : undefined}
            onClick={activate}
            onKeyDown={(event) => onItemKeyDown(event, activate)}
          >
            <span>{option.label}</span>
          </div>
        );
      })}
    </fieldset>
  );
}

export function MenuBar({
  label,
  menus,
}: {
  readonly label: string;
  readonly menus: readonly MenuDefinition[];
}) {
  const baseId = useId();
  const [open, setOpen] = useState<OpenState | null>(null);
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  // Pointing at or focusing another entry of the menu closes its open submenu.
  const closeSubmenuOutside = (target: EventTarget) => {
    if (target instanceof Element && target.closest(SUBMENU_SELECTOR) === null)
      setOpenSubmenuId(null);
  };
  // A menu always opens (and closes) with its submenus closed.
  const setMenuOpen = useCallback((next: OpenState | null) => {
    setOpenSubmenuId(null);
    setOpen(next);
  }, []);
  // The title that is in the tab order (roving tabindex).
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  const triggerId = (index: number) => `${baseId}-trigger-${index}`;
  const menuId = (index: number) => `${baseId}-menu-${index}`;

  const focusTrigger = useCallback((index: number) => {
    setActiveIndex(index);
    triggerRefs.current[index]?.focus();
  }, []);

  const openMenu = (menuIndex: number, focus: FocusTarget) => {
    setActiveIndex(menuIndex);
    setMenuOpen({ menuIndex, focus });
  };

  // Moves the focus into the menu that was just opened (its elements exist only after
  // the render that opened it).
  useEffect(() => {
    if (open === null) return;
    if (open.focus === "trigger") {
      triggerRefs.current[open.menuIndex]?.focus();
      return;
    }
    const items = itemsOf(menuRef.current);
    (open.focus === "first" ? items[0] : items[items.length - 1])?.focus();
  }, [open]);

  const menuOpen = open !== null;
  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(null);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [menuOpen, setMenuOpen]);

  // F10 moves the focus to the menu bar from anywhere in the window.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        event.key !== MENUBAR_SHORTCUT_KEY ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }
      event.preventDefault();
      setMenuOpen(null);
      triggerRefs.current[activeIndex]?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, setMenuOpen]);

  const menuCount = menus.length;
  const neighbour = (index: number, step: 1 | -1) =>
    (index + step + menuCount) % menuCount;

  const closeAndReturn = (index: number) => {
    setMenuOpen(null);
    focusTrigger(index);
  };

  const onTriggerKeyDown = (event: KeyboardEvent, index: number) => {
    switch (event.key) {
      case "Enter":
      case " ":
      case "ArrowDown":
        event.preventDefault();
        openMenu(index, "first");
        return;
      case "ArrowUp":
        event.preventDefault();
        openMenu(index, "last");
        return;
      case "ArrowRight":
      case "ArrowLeft": {
        event.preventDefault();
        const next = neighbour(index, event.key === "ArrowRight" ? 1 : -1);
        if (open === null) focusTrigger(next);
        else openMenu(next, "trigger");
        return;
      }
      case "Home":
        event.preventDefault();
        focusTrigger(0);
        return;
      case "End":
        event.preventDefault();
        focusTrigger(menuCount - 1);
        return;
      case "Escape":
        if (open !== null) {
          event.preventDefault();
          setMenuOpen(null);
        }
        return;
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent, index: number) => {
    const items = itemsOf(menuRef.current);
    const current = items.indexOf(document.activeElement as HTMLElement);
    const moveTo = (target: number) => {
      event.preventDefault();
      items[(target + items.length) % items.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        moveTo(current + 1);
        return;
      case "ArrowUp":
        moveTo(current < 0 ? -1 : current - 1);
        return;
      case "Home":
        moveTo(0);
        return;
      case "End":
        moveTo(-1);
        return;
      case "Escape":
        event.preventDefault();
        closeAndReturn(index);
        return;
      case "Tab":
        // Leaves the menu; the focus then continues from the title.
        setMenuOpen(null);
        focusTrigger(index);
        return;
      case "ArrowRight":
      case "ArrowLeft":
        event.preventDefault();
        openMenu(
          neighbour(index, event.key === "ArrowRight" ? 1 : -1),
          "first",
        );
        return;
    }
  };

  // A disabled entry is focusable but does nothing, as the pattern asks.
  const activate =
    (index: number) => (select: () => void, disabled: boolean) => {
      if (disabled) return;
      closeAndReturn(index);
      select();
    };

  return (
    <div ref={rootRef} role="menubar" aria-label={label} className="menu-bar">
      {menus.map((menu, index) => {
        const expanded = open?.menuIndex === index;
        return (
          <div key={menu.id} className="menu-bar__menu">
            <div
              ref={(element) => {
                triggerRefs.current[index] = element;
              }}
              id={triggerId(index)}
              role="menuitem"
              tabIndex={index === activeIndex ? 0 : -1}
              className="menu-bar__trigger"
              aria-haspopup="menu"
              aria-expanded={expanded}
              aria-controls={expanded ? menuId(index) : undefined}
              onClick={() =>
                expanded ? setMenuOpen(null) : openMenu(index, "first")
              }
              onKeyDown={(event) => onTriggerKeyDown(event, index)}
              onMouseEnter={() => {
                if (open !== null && !expanded) openMenu(index, "trigger");
              }}
            >
              {menu.label}
            </div>
            {expanded ? (
              <div
                ref={menuRef}
                id={menuId(index)}
                role="menu"
                aria-labelledby={triggerId(index)}
                className="menu-bar__popup"
                onKeyDown={(event) => onMenuKeyDown(event, index)}
                onMouseOver={(event) => closeSubmenuOutside(event.target)}
                onFocus={(event) => closeSubmenuOutside(event.target)}
              >
                {menu.entries.map((entry) => (
                  <MenuEntryView
                    key={entry.id}
                    entry={entry}
                    onActivate={activate(index)}
                    submenu={{
                      openId: openSubmenuId,
                      setOpenId: setOpenSubmenuId,
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
