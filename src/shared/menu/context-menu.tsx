import {
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { LAYOUT_CONFIG } from "../../config/layout-config";
import { type MenuPoint, placeContextMenu } from "./context-menu-placement";
import { MenuList, type PopupMenuEntry, type PopupMenuItem } from "./menu-list";
import "./popup-menu.css";

interface OpenContextMenu {
  // A new menu replaces the open one from scratch (focus, placement).
  readonly openId: number;
  readonly anchor: MenuPoint;
  readonly label: string;
  readonly entries: readonly PopupMenuEntry[];
}

// The menu is rendered in a portal, but React still bubbles its events to the component
// that opened it (the canvas would start a range selection on a click in the menu, or
// treat the arrow keys as a nudge). The menu's events stop at the menu.
function stop(event: SyntheticEvent): void {
  event.stopPropagation();
}

function ContextMenuPopup({
  menu,
  onDismiss,
  onLeave,
  onChoose,
}: {
  readonly menu: OpenContextMenu;
  readonly onDismiss: () => void;
  readonly onLeave: () => void;
  readonly onChoose: (item: PopupMenuItem) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  // First rendered at the pointer, then moved once its size is known; both happen before
  // the browser paints, so the move is never seen.
  const [position, setPosition] = useState<MenuPoint | null>(null);

  useLayoutEffect(() => {
    const rect = listRef.current?.getBoundingClientRect();
    setPosition(
      placeContextMenu(
        menu.anchor,
        { width: rect?.width ?? 0, height: rect?.height ?? 0 },
        { width: window.innerWidth, height: window.innerHeight },
        LAYOUT_CONFIG.contextMenuEdgeMarginPx,
      ),
    );
  }, [menu.anchor]);

  function onBlur(event: ReactFocusEvent<HTMLDivElement>): void {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    onLeave();
  }

  const shown = position ?? menu.anchor;
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: only keeps the menu's events from reaching the component that opened it.
    <div
      className="context-menu"
      onBlur={onBlur}
      onKeyDown={stop}
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <MenuList
        listRef={listRef}
        label={menu.label}
        entries={menu.entries}
        onDismiss={onDismiss}
        onChoose={onChoose}
        className="context-menu__list"
        style={{
          left: shown.x,
          top: shown.y,
        }}
      />
    </div>,
    document.body,
  );
}

export interface ContextMenuControl {
  // Opens the menu for a `contextmenu` event (right-click, the Menu key, Shift+F10) and
  // suppresses the webview's own menu. A keyboard-opened event has no pointer position, so
  // the menu goes to the bottom-left corner of `anchorElement` (default: the element
  // the handler is on) instead.
  readonly openFromEvent: (
    event: ReactMouseEvent,
    label: string,
    entries: readonly PopupMenuEntry[],
    anchorElement?: Element | null,
  ) => void;
  // Rendered by the owner anywhere in its tree; null while closed.
  readonly element: ReactNode;
}

// One right-click menu per owner. Escape and choosing an item put focus back where it was
// (so a dialog opened by the item remembers it); focus leaving the menu just closes it.
export function useContextMenu(): ContextMenuControl {
  const [menu, setMenu] = useState<OpenContextMenu | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const nextOpenId = useRef(0);

  const openFromEvent = useCallback(
    (
      event: ReactMouseEvent,
      label: string,
      entries: readonly PopupMenuEntry[],
      anchorElement?: Element | null,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const fromKeyboard = event.clientX === 0 && event.clientY === 0;
      const corner = (
        anchorElement ?? event.currentTarget
      ).getBoundingClientRect();
      const anchor = fromKeyboard
        ? { x: corner.left, y: corner.bottom }
        : { x: event.clientX, y: event.clientY };
      const active = document.activeElement;
      returnFocus.current = active instanceof HTMLElement ? active : null;
      nextOpenId.current += 1;
      setMenu({ openId: nextOpenId.current, anchor, label, entries });
    },
    [],
  );

  function close(restore: boolean): void {
    setMenu(null);
    if (restore) returnFocus.current?.focus({ preventScroll: true });
  }

  const element =
    menu === null ? null : (
      <ContextMenuPopup
        key={menu.openId}
        menu={menu}
        onDismiss={() => close(true)}
        onLeave={() => close(false)}
        onChoose={(item) => {
          close(true);
          item.onSelect();
        }}
      />
    );

  return { openFromEvent, element };
}
