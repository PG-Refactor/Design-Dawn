import {
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { SheetId } from "../../domain/shared/entity-id";
import {
  dropSlotAt,
  dropTargetOf,
  exceedsDragThreshold,
  type PointerPoint,
  type TabRect,
} from "./view-models/tab-drag";

const PRIMARY_BUTTON = 0;
const ESCAPE_KEY = "Escape";

interface DragSession {
  readonly sheetId: SheetId;
  readonly pointerId: number;
  readonly start: PointerPoint;
  // True once the pointer travelled far enough: before that it is still a click.
  active: boolean;
  // Escape ended the drag but the pointer is still down; releasing it must not drop.
  cancelled: boolean;
  slot: number | null;
}

export interface SheetTabDragState {
  readonly sheetId: SheetId;
  // The insertion slot to indicate (0..tabs), or null when a drop would not move the tab.
  readonly slot: number | null;
}

export interface SheetTabDragOptions {
  readonly tabIds: readonly SheetId[];
  readonly getRects: () => readonly TabRect[];
  readonly onDrop: (sheetId: SheetId, before: SheetId | null) => void;
}

export interface SheetTabPointerHandlers {
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: () => void;
}

// Reorders tabs with pointer events. HTML5 drag and drop is not used: the Tauri window
// keeps its own file-drop handling on, which turns HTML5 DnD off in WebView2 on Windows.
export function useSheetTabDrag({
  tabIds,
  getRects,
  onDrop,
}: SheetTabDragOptions) {
  const session = useRef<DragSession | null>(null);
  // The click that ends a drag (the browser still sends it to the captured tab) must not
  // select the tab.
  const suppressClick = useRef(false);
  const [dragState, setDragState] = useState<SheetTabDragState | null>(null);
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
        state === null ? null : { sheetId: state.sheetId, slot: null },
      );
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [dragging]);

  function handlersFor(sheetId: SheetId): SheetTabPointerHandlers {
    return {
      onPointerDown(event) {
        suppressClick.current = false;
        if (event.button !== PRIMARY_BUTTON || !event.isPrimary) return;
        session.current = {
          sheetId,
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
          current.sheetId !== sheetId ||
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
        const slot = dropSlotAt(getRects(), point);
        const target = dropTargetOf(tabIds, sheetId, slot);
        current.slot = target === null ? null : slot;
        setDragState({ sheetId, slot: current.slot });
      },
      onPointerUp(event) {
        const current = session.current;
        if (current === null || current.pointerId !== event.pointerId) return;
        const { active, cancelled, slot } = current;
        finish();
        if (!active) return;
        suppressClick.current = true;
        if (cancelled || slot === null) return;
        const target = dropTargetOf(tabIds, sheetId, slot);
        if (target !== null) onDrop(sheetId, target.before);
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
