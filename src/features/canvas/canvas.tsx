import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ApplicationState } from "../../application/state/application-state";
import { CANVAS_CONFIG } from "../../config/canvas-config";
import type { Block } from "../../domain/block/block";
import type {
  BlockId,
  DocumentId,
  SheetId,
} from "../../domain/shared/entity-id";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { getSelection, stopEditingSheet } from "../workspace/ui-state/ui-state";
import { useUiState } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import {
  BLOCK_ID_ATTRIBUTE,
  CANVAS_ATTRIBUTE,
  isInsideBlockEditor,
  RESIZE_HANDLE_ATTRIBUTE,
} from "./block-dom";
import { BlockFrame } from "./block-frame";
import { createCanvasInput } from "./canvas-input";
import {
  CANVAS_KEY_COMMANDS,
  isEditableTarget,
  isPanModifierKey,
  isSnapSuspendKey,
  keyCommandOf,
} from "./canvas-keyboard";
import { CANVAS_MESSAGES } from "./canvas-messages";
import { routePointerDown } from "./canvas-pointer-routing";
import { displayedFrame, isInteracting } from "./geometry/preview-frame";
import { normalizeRect } from "./geometry/range-selection";
import {
  DEFAULT_VIEWPORT,
  type Point,
  type Rect,
  worldLayerTransform,
} from "./geometry/viewport-math";
import "./canvas.css";

const NO_BLOCKS: readonly Block[] = [];

// Key command -> z-order direction (the other key commands are not z-order changes).
const REORDER_KEY_COMMANDS = {
  [CANVAS_KEY_COMMANDS.bringForward]: "forward",
  [CANVAS_KEY_COMMANDS.sendBackward]: "backward",
  [CANVAS_KEY_COMMANDS.bringToFront]: "toFront",
  [CANVAS_KEY_COMMANDS.sendToBack]: "toBack",
} as const;

// Screen position relative to the canvas element (the origin of `pan`).
function pointRelativeTo(
  element: HTMLElement,
  event: { readonly clientX: number; readonly clientY: number },
): Point {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

// The selection rectangle being dragged. Decorative: the selection result is announced
// through the blocks' aria-selected.
function RangeSelectionRect({ rect }: { readonly rect: Rect }) {
  return (
    <div
      aria-hidden="true"
      data-testid="canvas-range-selection"
      className="canvas__range-selection"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}
    />
  );
}

export interface CanvasProps {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  readonly sheetName: string;
}

// The Infinite Canvas of one sheet: a viewport element holding a world layer that is
// moved / scaled with a CSS transform. Blocks come from the application store (the single
// source of truth); selection, drag / resize previews and the viewport come from UI state.
export function Canvas({ documentId, sheetId, sheetName }: CanvasProps) {
  const { applicationStore, uiStateStore, canvasActions } =
    useWorkspaceServices();
  const selectBlocks = useCallback(
    (application: ApplicationState): readonly Block[] =>
      application.documents.get(documentId)?.sheets.get(sheetId)?.blocks ??
      NO_BLOCKS,
    [documentId, sheetId],
  );
  const blocks = useStoreSelector(applicationStore, selectBlocks);
  const selection = useUiState(
    useCallback((ui) => getSelection(ui, sheetId), [sheetId]),
  );
  const interaction = useUiState((ui) => ui.interaction);
  const storedViewport = useUiState(
    useCallback((ui) => ui.viewportBySheet.get(sheetId), [sheetId]),
  );
  const viewport = storedViewport ?? DEFAULT_VIEWPORT;
  const fileDragActive = useUiState((ui) => ui.fileDragActive);

  const input = useMemo(
    () =>
      createCanvasInput({
        applicationStore,
        uiStateStore,
        actions: canvasActions,
        documentId,
        sheetId,
      }),
    [applicationStore, uiStateStore, canvasActions, documentId, sheetId],
  );
  // Leaving the sheet mid-gesture must not leave a preview behind.
  useEffect(() => () => input.cancel(), [input]);

  // The block contents are read when the sheet is shown (this component is keyed by the
  // sheet); the call is idempotent, so a repeat costs nothing.
  useEffect(() => {
    void canvasActions.loadSheetContents({ documentId, sheetId });
  }, [canvasActions, documentId, sheetId]);

  // Leaving the sheet ends the edit mode of its blocks (the editor commits its own draft).
  useEffect(
    () => () =>
      uiStateStore.setState((state) => stopEditingSheet(state, sheetId)),
    [uiStateStore, sheetId],
  );

  const elementRef = useRef<HTMLDivElement>(null);

  // Space held on the canvas = pan modifier. The ref is what handlers read (always
  // current); the state only drives the grab cursor.
  const spaceHeldRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const updateSpaceHeld = useCallback((held: boolean) => {
    spaceHeldRef.current = held;
    setSpaceHeld(held);
  }, []);
  // A key-up that happens while the window is not focused would never be seen.
  useEffect(() => {
    const release = () => updateSpaceHeld(false);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") release();
    };
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [updateSpaceHeld]);

  function canvasSize() {
    const rect = elementRef.current?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  }

  // React registers wheel listeners as passive, which cannot stop the page from scrolling
  // or the webview from zooming; a native non-passive listener can.
  useEffect(() => {
    const element = elementRef.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent) => {
      if (isInsideBlockEditor(event.target)) {
        // The editor scrolls itself. Zoom with Ctrl would still zoom the whole page.
        if (event.ctrlKey || event.metaKey) event.preventDefault();
        return;
      }
      event.preventDefault();
      input.wheel({
        point: pointRelativeTo(element, event),
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        zoom: event.ctrlKey || event.metaKey,
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [input]);

  function blockIdOf(element: Element, attribute: string): BlockId | null {
    const raw = element.closest(`[${attribute}]`)?.getAttribute(attribute);
    // Looked up in the sheet instead of cast, so only a real block id gets through.
    return blocks.find((block) => block.blockId === raw)?.blockId ?? null;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const route = routePointerDown({
      button: event.button,
      spaceHeld: spaceHeldRef.current,
    });
    if (route === "ignore") return;
    // A block editor owns its pointer events (text selection, caret, scrollbars).
    if (isInsideBlockEditor(event.target)) return;
    const element = event.currentTarget;
    element.focus({ preventScroll: true });
    // jsdom has no pointer capture; real webviews do.
    if (typeof element.setPointerCapture === "function") {
      element.setPointerCapture(event.pointerId);
    }
    const point = pointRelativeTo(element, event);
    if (route === "pan") {
      // Stops the middle button's auto-scroll; panning must never change the selection.
      event.preventDefault();
      input.pointerDownForPan(point);
      return;
    }
    const target = event.target as Element;
    const handleBlockId = target.closest(`[${RESIZE_HANDLE_ATTRIBUTE}]`)
      ? blockIdOf(target, BLOCK_ID_ATTRIBUTE)
      : null;
    if (handleBlockId !== null) {
      input.pointerDownOnResizeHandle(handleBlockId, point);
      return;
    }
    const blockId = blockIdOf(target, BLOCK_ID_ATTRIBUTE);
    if (blockId === null) {
      input.pointerDownOnBackground(
        point,
        event.ctrlKey || event.metaKey || event.shiftKey,
      );
      return;
    }
    input.pointerDownOnBlock(
      blockId,
      point,
      event.ctrlKey || event.metaKey || event.shiftKey,
    );
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!input.isGestureActive()) return;
    input.pointerMove(
      pointRelativeTo(event.currentTarget, event),
      event.altKey,
    );
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    if (
      typeof element.hasPointerCapture === "function" &&
      element.hasPointerCapture(event.pointerId)
    ) {
      element.releasePointerCapture(event.pointerId);
    }
    void input.pointerUp();
  }

  // The element under the pointer, not `event.target`: the pointer capture taken on
  // pointerdown (for dragging) makes WebKitGTK aim the dblclick at the canvas itself.
  function elementUnderPointer(
    event: MouseEvent<HTMLDivElement>,
  ): Element | null {
    const { ownerDocument } = event.currentTarget;
    // jsdom has no layout (no elementFromPoint); real webviews do.
    const hit =
      typeof ownerDocument.elementFromPoint === "function"
        ? ownerDocument.elementFromPoint(event.clientX, event.clientY)
        : event.target;
    return hit instanceof Element && event.currentTarget.contains(hit)
      ? hit
      : null;
  }

  function onDoubleClick(event: MouseEvent<HTMLDivElement>) {
    const target = elementUnderPointer(event);
    if (target === null) return;
    if (isInsideBlockEditor(target)) return;
    if (target.closest(`[${RESIZE_HANDLE_ATTRIBUTE}]`)) return;
    const blockId = blockIdOf(target, BLOCK_ID_ATTRIBUTE);
    if (blockId === null) return;
    canvasActions.beginBlockEdit({ documentId, sheetId, blockId });
  }

  // Alt toggles the grid snap of the move / resize in progress. Its default action (the
  // menu bar taking focus on release) is suppressed only then, so the gesture is not
  // interrupted; Alt outside a gesture and inside editors is left alone.
  function onSnapSuspendKey(
    event: KeyboardEvent<HTMLDivElement>,
    suspended: boolean,
  ): boolean {
    if (!isSnapSuspendKey(event)) return false;
    if (isEditableTarget(event.target) || isInsideBlockEditor(event.target)) {
      return false;
    }
    if (!input.isGestureActive()) return false;
    event.preventDefault();
    input.setSnapSuspended(suspended);
    return true;
  }

  function onKeyUp(event: KeyboardEvent<HTMLDivElement>) {
    if (onSnapSuspendKey(event, false)) return;
    if (isPanModifierKey(event)) updateSpaceHeld(false);
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    // Focus moving between the canvas and its blocks keeps the modifier.
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    updateSpaceHeld(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Editors and inputs own their keys (Space, copy / paste, text undo ...).
    if (isEditableTarget(event.target) || isInsideBlockEditor(event.target)) {
      return;
    }
    if (onSnapSuspendKey(event, true)) return;
    if (isPanModifierKey(event)) {
      event.preventDefault();
      updateSpaceHeld(true);
      return;
    }
    const command = keyCommandOf(event);
    if (command === null) return;
    if (command === CANVAS_KEY_COMMANDS.cancelGesture) {
      if (input.isGestureActive()) {
        event.preventDefault();
        input.cancel();
      }
      return;
    }
    // Editing shortcuts wait for the gesture to finish.
    if (input.isGestureActive()) return;
    event.preventDefault();
    switch (command) {
      case CANVAS_KEY_COMMANDS.deleteSelection:
        void canvasActions.deleteSelection({
          documentId,
          sheetId,
          blockIds: blocks
            .map((block) => block.blockId)
            .filter((blockId) => selection.has(blockId)),
        });
        return;
      case CANVAS_KEY_COMMANDS.startEditing: {
        const selected = blocks.filter((block) => selection.has(block.blockId));
        const [only] = selected;
        if (selected.length === 1 && only !== undefined) {
          canvasActions.beginBlockEdit({
            documentId,
            sheetId,
            blockId: only.blockId,
          });
        }
        return;
      }
      case CANVAS_KEY_COMMANDS.copy:
        void canvasActions.copySelection({ documentId, sheetId });
        return;
      case CANVAS_KEY_COMMANDS.cut:
        void canvasActions.cutSelection({ documentId, sheetId });
        return;
      case CANVAS_KEY_COMMANDS.paste:
        void canvasActions.pasteClipboard({
          documentId,
          sheetId,
          viewportSize: canvasSize(),
        });
        return;
      case CANVAS_KEY_COMMANDS.duplicate:
        void canvasActions.duplicateSelection({ documentId, sheetId });
        return;
      case CANVAS_KEY_COMMANDS.bringForward:
      case CANVAS_KEY_COMMANDS.sendBackward:
      case CANVAS_KEY_COMMANDS.bringToFront:
      case CANVAS_KEY_COMMANDS.sendToBack:
        void canvasActions.reorderSelection({
          documentId,
          sheetId,
          direction: REORDER_KEY_COMMANDS[command],
        });
        return;
      case CANVAS_KEY_COMMANDS.undo:
        void canvasActions.undo(documentId);
        return;
      case CANVAS_KEY_COMMANDS.redo:
        void canvasActions.redo(documentId);
        return;
    }
  }

  const { interval: gridSize } = CANVAS_CONFIG.grid;
  // The grid follows the viewport, so panning and zooming are visible on an empty canvas.
  const style = {
    "--canvas-zoom": viewport.zoom,
    backgroundSize: `${gridSize * viewport.zoom}px ${gridSize * viewport.zoom}px`,
    backgroundPosition: `${viewport.panX}px ${viewport.panY}px`,
  } as CSSProperties;

  return (
    <div
      ref={elementRef}
      role="listbox"
      aria-multiselectable="true"
      aria-label={sheetName}
      tabIndex={0}
      className={spaceHeld ? "canvas canvas--pan-ready" : "canvas"}
      style={style}
      {...{ [CANVAS_ATTRIBUTE]: "" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => input.cancel()}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={onBlur}
    >
      <div
        className="canvas__world"
        data-testid="canvas-world"
        style={{ transform: worldLayerTransform(viewport) }}
      >
        {blocks.map((block) => {
          const frame = displayedFrame(block, interaction, sheetId);
          return (
            <BlockFrame
              key={block.blockId}
              documentId={documentId}
              sheetId={sheetId}
              block={block}
              selected={selection.has(block.blockId)}
              interacting={isInteracting(block, interaction, sheetId)}
              x={frame.x}
              y={frame.y}
              width={frame.width}
              height={frame.height}
            />
          );
        })}
        {interaction.kind === "rangeSelecting" &&
          interaction.sheetId === sheetId && (
            <RangeSelectionRect
              rect={normalizeRect(interaction.start, interaction.current)}
            />
          )}
      </div>
      {fileDragActive && (
        <div
          aria-hidden="true"
          data-testid="canvas-drop-overlay"
          className="canvas__drop-overlay"
        >
          {CANVAS_MESSAGES.dropHint}
        </div>
      )}
    </div>
  );
}
