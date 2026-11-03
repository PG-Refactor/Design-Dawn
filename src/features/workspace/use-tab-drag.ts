import {
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  dropSlotAt,
  dropTargetOf,
  exceedsDragThreshold,
  type PointerPoint,
  type TabRect,
} from "./view-models/tab-drag";

const PRIMARY_BUTTON = 0;
const ESCAPE_KEY = "Escape";

interface DragSession<Id> {
  readonly tabId: Id;
  readonly pointerId: number;
  readonly start: PointerPoint;
  // True once the pointer travelled far enough: before that it is still a click.
  active: boolean;
  // Escape ended the drag but the pointer is still down; releasing it must not drop.
  cancelled: boolean;
  slot: number | null;
}

export interface TabDragState<Id> {
  readonly tabId: Id;
  // The insertion slot to indicate (0..tabs), or null when a drop would not move the tab.
  readonly slot: number | null;
  // The pointer is outside the window: letting go there takes the tab out of it.
  readonly outside: boolean;
}

export interface TabDragOptions<Id> {
  readonly tabIds: readonly Id[];
  readonly getRects: () => readonly TabRect[];
  readonly onDrop: (tabId: Id, before: Id | null) => void;
  // Letting go outside the window (screen pixels). Without it, that is no drop at all.
  readonly onDropOutside?: (
    tabId: Id,
    screenX: number,
    screenY: number,
  ) => void;
}

// Whether a pointer position (relative to the page) lies outside the window.
function isOutsideWindow(point: PointerPoint): boolean {
  return (
    point.x < 0 ||
    point.y < 0 ||
    point.x >= window.innerWidth ||
    point.y >= window.innerHeight
  );
}

export interface TabPointerHandlers {
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: () => void;
}

// Reorders tabs (Sheet Tabs and Document Tabs alike) with pointer events. HTML5 drag and drop is not used: the Tauri window
// keeps its own file-drop handling on, which turns HTML5 DnD off in WebView2 on Windows.
export function useTabDrag<Id>({
  tabIds,
  getRects,
  onDrop,
  onDropOutside,
}: TabDragOptions<Id>) {
  const session = useRef<DragSession<Id> | null>(null);
  // The click that ends a drag (the browser still sends it to the captured tab) must not
  // select the tab.
  const suppressClick = useRef(false);
  const [dragState, setDragState] = useState<TabDragState<Id> | null>(null);
  const dragging = dragState !== null;

  const finish = useCallback(() => {
    session.current = null;
    setDragState(null);
  }, []);

  // Escape cancels wherever focus is; the pointer is still captured by the tab.
  useEffect(() => {
    if (!dragging) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== ESCAPE_KEY || session.current === null) return;
      event.preventDefault();
      event.stopPropagation();
      session.current.cancelled = true;
      session.current.slot = null;
      setDragState((state) =>
        state === null
          ? null
          : { tabId: state.tabId, slot: null, outside: false },
      );
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [dragging]);

  function handlersFor(tabId: Id): TabPointerHandlers {
    return {
      onPointerDown(event) {
        suppressClick.current = false;
        if (event.button !== PRIMARY_BUTTON || !event.isPrimary) return;
        session.current = {
          tabId,
          pointerId: event.pointerId,
          start: { x: event.clientX, y: event.clientY },
          active: false,
          cancelled: false,
          slot: null,
        };
        // Optional call: not every environment implements pointer capture.
        event.currentTarget.setPointerCapture?.(event.pointerId);
      },
      onPointerMove(event) {
        const current = session.current;
        if (
          current === null ||
          current.tabId !== tabId ||
          current.pointerId !== event.pointerId ||
          current.cancelled
        ) {
          return;
        }
        const point = { x: event.clientX, y: event.clientY };
        if (!current.active) {
          if (!exceedsDragThreshold(current.start, point)) return;
          current.active = true;
        }
        const outside = onDropOutside !== undefined && isOutsideWindow(point);
        const slot = dropSlotAt(getRects(), point);
        const target = outside ? null : dropTargetOf(tabIds, tabId, slot);
        current.slot = target === null ? null : slot;
        setDragState({ tabId, slot: current.slot, outside });
      },
      onPointerUp(event) {
        const current = session.current;
        if (current === null || current.pointerId !== event.pointerId) return;
        const { active, cancelled, slot } = current;
        finish();
        if (!active) return;
        suppressClick.current = true;
        if (cancelled) return;
        if (
          onDropOutside !== undefined &&
          isOutsideWindow({ x: event.clientX, y: event.clientY })
        ) {
          onDropOutside(tabId, event.screenX, event.screenY);
          return;
        }
        if (slot === null) return;
        const target = dropTargetOf(tabIds, tabId, slot);
        if (target !== null) onDrop(tabId, target.before);
      },
      onPointerCancel() {
        finish();
      },
    };
  }

  return {
    dragState,
    handlersFor,
    // True once for the click that follows a drag.
    consumeClickSuppression(): boolean {
      const suppressed = suppressClick.current;
      suppressClick.current = false;
      return suppressed;
    },
  };
}
