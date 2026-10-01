import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  isInsideBlockEditor,
  RESIZE_HANDLE_ATTRIBUTE,
} from "./block-dom";
import { BlockFrame } from "./block-frame";
import { createCanvasInput } from "./canvas-input";
import {
  CANVAS_KEY_COMMANDS,
  isEditableTarget,
  keyCommandOf,
} from "./canvas-keyboard";
import { displayedFrame, isInteracting } from "./geometry/preview-frame";
import {
  DEFAULT_VIEWPORT,
  type Point,
  worldLayerTransform,
} from "./geometry/viewport-math";
import "./canvas.css";

const NO_BLOCKS: readonly Block[] = [];
const PRIMARY_BUTTON = 0;

// Screen position relative to the canvas element (the origin of `pan`).
function pointRelativeTo(
  element: HTMLElement,
  event: { readonly clientX: number; readonly clientY: number },
): Point {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
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
    if (event.button !== PRIMARY_BUTTON) return;
    // A block editor owns its pointer events (text selection, caret, scrollbars).
    if (isInsideBlockEditor(event.target)) return;
    const element = event.currentTarget;
    element.focus({ preventScroll: true });
    // jsdom has no pointer capture; real webviews do.
    if (typeof element.setPointerCapture === "function") {
      element.setPointerCapture(event.pointerId);
    }
    const point = pointRelativeTo(element, event);
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
      input.pointerDownOnBackground(point);
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
    input.pointerMove(pointRelativeTo(event.currentTarget, event));
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

  function onDoubleClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as Element;
    if (isInsideBlockEditor(target)) return;
    if (target.closest(`[${RESIZE_HANDLE_ATTRIBUTE}]`)) return;
    const blockId = blockIdOf(target, BLOCK_ID_ATTRIBUTE);
    if (blockId === null) return;
    canvasActions.beginBlockEdit({ documentId, sheetId, blockId });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isEditableTarget(event.target) || isInsideBlockEditor(event.target)) {
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
      case CANVAS_KEY_COMMANDS.undo:
        void canvasActions.undo(documentId);
        return;
      case CANVAS_KEY_COMMANDS.redo:
        void canvasActions.redo(documentId);
        return;
    }
  }

  const { size: gridSize } = CANVAS_CONFIG.grid;
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
      className="canvas"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => input.cancel()}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
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
      </div>
    </div>
  );
}
