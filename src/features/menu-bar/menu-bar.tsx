import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type {
  MenuDefinition,
  MenuEntry,
  MenuRadioGroup,
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

function itemsOf(menu: HTMLElement | null): HTMLElement[] {
  return menu === null
    ? []
    : [...menu.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)];
}

type ActivateHandler = (select: () => void, disabled: boolean) => void;

// Enter and Space on the focused item are handled here (not on the menu) so every item
// is operable by keyboard on its own.
function onItemKeyDown(event: KeyboardEvent, activate: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
}

function MenuEntryView({
  entry,
  onActivate,
}: {
  readonly entry: MenuEntry;
  readonly onActivate: ActivateHandler;
}) {
  switch (entry.kind) {
    case "separator":
      return <hr className="menu-bar__separator" />;
    case "item": {
      const activate = () =>
        onActivate(entry.onSelect, entry.disabled === true);
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
    setOpen({ menuIndex, focus });
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
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [menuOpen]);

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
      setOpen(null);
      triggerRefs.current[activeIndex]?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex]);

  const menuCount = menus.length;
  const neighbour = (index: number, step: 1 | -1) =>
    (index + step + menuCount) % menuCount;

  const closeAndReturn = (index: number) => {
    setOpen(null);
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
          setOpen(null);
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
        setOpen(null);
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
                expanded ? setOpen(null) : openMenu(index, "first")
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
              >
                {menu.entries.map((entry) => (
                  <MenuEntryView
                    key={entry.id}
                    entry={entry}
                    onActivate={activate(index)}
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
