import {
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  exceedsDragThreshold,
  type PointerPoint,
} from "./view-models/tab-drag";
import {
  type TreeDropHit,
  type TreeDropRow,
  type TreeMoveTarget,
  treeDropHitAt,
} from "./view-models/tree-drag";

const PRIMARY_BUTTON = 0;
const ESCAPE_KEY = "Escape";

export type TreeRowKind = "project" | "folder" | "folderCollapsed" | "document";

interface DragSession {
  readonly key: string;
  readonly pointerId: number;
  readonly start: PointerPoint;
  // True once the pointer travelled far enough: before that it is still a click.
  active: boolean;
  // Escape ended the drag while the pointer is still down; releasing it must not drop.
  cancelled: boolean;
  target: TreeMoveTarget | null;
}

export interface TreeDragState {
  readonly key: string;
  // What a drop now would land on; null when it would do nothing (no indicator).
  readonly hit: TreeDropHit | null;
}

export interface TreeDragOptions {
  // The visible rows in display order, measured now.
  readonly getRows: () => readonly TreeDropRow[];
  readonly rowKind: (key: string) => TreeRowKind;
  // What dropping `key` on `hit` would do; null = nothing (not allowed, or no change).
  readonly resolveTarget: (
    key: string,
    hit: TreeDropHit | null,
  ) => TreeMoveTarget | null;
  readonly onDrop: (key: string, target: TreeMoveTarget) => void;
}

export interface TreeRowPointerHandlers {
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: () => void;
}

// Moves Project Tree rows by dragging them, with pointer events like the tabs. HTML5 drag
// and drop is not used: the Tauri window keeps its own file-drop handling on, which turns
// HTML5 DnD off in WebView2 on Windows.
export function useTreeDrag({
  getRows,
  rowKind,
  resolveTarget,
  onDrop,
}: TreeDragOptions) {
  const session = useRef<DragSession | null>(null);
  // The click that ends a drag (the browser still sends it to the captured row) must not
  // select or open the row.
  const suppressClick = useRef(false);
  const [dragState, setDragState] = useState<TreeDragState | null>(null);
  const dragging = dragState !== null;

  const finish = useCallback(() => {
    session.current = null;
    setDragState(null);
  }, []);

  // Escape cancels wherever focus is; the pointer is still captured by the row.
  useEffect(() => {
    if (!dragging) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== ESCAPE_KEY || session.current === null) return;
      event.preventDefault();
      event.stopPropagation();
      session.current.cancelled = true;
      session.current.target = null;
      setDragState((state) =>
        state === null ? null : { key: state.key, hit: null },
      );
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [dragging]);

  function handlersFor(key: string): TreeRowPointerHandlers {
    return {
      onPointerDown(event) {
        suppressClick.current = false;
        if (event.button !== PRIMARY_BUTTON || !event.isPrimary) return;
        // The row's own controls (the "⋮" menu, the rename input) are not drag handles.
        if (
          event.target instanceof Element &&
          event.target.closest("button, input") !== null
        ) {
          return;
        }
        session.current = {
          key,
          pointerId: event.pointerId,
          start: { x: event.clientX, y: event.clientY },
          active: false,
          cancelled: false,
          target: null,
        };
        // Optional call: not every environment implements pointer capture.
        event.currentTarget.setPointerCapture?.(event.pointerId);
      },
      onPointerMove(event) {
        const current = session.current;
        if (
          current === null ||
          current.key !== key ||
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
        const hit = treeDropHitAt(getRows(), point.y, rowKind);
        current.target = resolveTarget(key, hit);
        setDragState({ key, hit: current.target === null ? null : hit });
      },
      onPointerUp(event) {
        const current = session.current;
        if (current === null || current.pointerId !== event.pointerId) return;
        const { active, cancelled, target } = current;
        finish();
        if (!active) return;
        suppressClick.current = true;
        if (cancelled || target === null) return;
        onDrop(key, target);
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
