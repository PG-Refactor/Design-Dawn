// Pointer / wheel gestures of one sheet's canvas. Framework-free: the component only
// translates DOM events into the calls below (positions are screen pixels relative to the
// canvas element).
//
// Flow of every gesture: pointer events -> UI state (selection, interaction preview,
// viewport) -> ONE application command when the gesture ends. A cancelled gesture
// (Escape, pointer cancel) commits nothing.

import type { Viewport } from "../../application/local-state/viewport";
import type { ApplicationStore } from "../../application/state/application-state";
import type { Block } from "../../domain/block/block";
import type {
  BlockId,
  DocumentId,
  SheetId,
} from "../../domain/shared/entity-id";
import {
  clearSelection,
  endInteraction,
  getSelection,
  selectBlocks,
  setViewport,
  startDrag,
  startRangeSelection,
  startResize,
  toggleBlockSelection,
  type UiStateStore,
  updateDrag,
  updateRangeSelection,
  updateResize,
} from "../workspace/ui-state/ui-state";
import type { CanvasActions } from "./canvas-actions";
import {
  exceedsDragThreshold,
  pointDifference,
  resizePreviewFrame,
} from "./geometry/interaction-math";
import {
  applyRangeHit,
  blocksHitByRect,
  normalizeRect,
} from "./geometry/range-selection";
import {
  DEFAULT_VIEWPORT,
  type Point,
  panBy,
  screenDeltaToWorld,
  screenToWorld,
  zoomByWheel,
} from "./geometry/viewport-math";

export interface CanvasInputDependencies {
  readonly applicationStore: ApplicationStore;
  readonly uiStateStore: UiStateStore;
  readonly actions: CanvasActions;
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
}

export interface WheelInput {
  readonly point: Point;
  readonly deltaX: number;
  readonly deltaY: number;
  // Ctrl / Meta held: zoom instead of pan.
  readonly zoom: boolean;
}

export interface CanvasInput {
  // `additive` (Ctrl / Meta / Shift) toggles the block in the selection.
  pointerDownOnBlock(blockId: BlockId, point: Point, additive: boolean): void;
  pointerDownOnResizeHandle(blockId: BlockId, point: Point): void;
  // Empty canvas: a click clears the selection, a drag draws the selection rectangle.
  // `additive` (Ctrl / Meta / Shift) makes the rectangle toggle instead of replace.
  pointerDownOnBackground(point: Point, additive?: boolean): void;
  // Space + left button or the middle button, anywhere: pan, never touching selection.
  pointerDownForPan(point: Point): void;
  pointerMove(point: Point): void;
  pointerUp(): Promise<void>;
  // Abandons the gesture in progress; nothing is committed.
  cancel(): void;
  wheel(input: WheelInput): void;
  isGestureActive(): boolean;
}

// Where a press is before / after it turned into a drag, resize or pan. The `press`
// variants are below the movement threshold, i.e. still possibly a click.
type Gesture =
  | {
      readonly kind: "blockPress";
      readonly blockId: BlockId;
      readonly start: Point;
      // The press landed on a block of a multi-selection; a click then narrows the
      // selection to that block, a drag moves the whole selection.
      readonly narrowOnClick: boolean;
    }
  | { readonly kind: "dragging"; readonly start: Point }
  | {
      readonly kind: "handlePress";
      readonly blockId: BlockId;
      readonly start: Point;
    }
  | {
      readonly kind: "resizing";
      readonly start: Point;
      readonly startFrame: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
    }
  | {
      readonly kind: "backgroundPress";
      readonly start: Point;
      readonly additive: boolean;
    }
  | { readonly kind: "rangeSelecting" }
  | {
      readonly kind: "panning";
      readonly start: Point;
      readonly startViewport: Viewport;
    };

export function createCanvasInput(
  dependencies: CanvasInputDependencies,
): CanvasInput {
  const { applicationStore, uiStateStore, actions, documentId, sheetId } =
    dependencies;
  let gesture: Gesture | null = null;
  // True while a finished drag / resize is waiting for its command. The preview is still
  // on screen then, so starting another gesture (or changing the viewport) must wait.
  let committing = false;

  function currentViewport(): Viewport {
    return (
      uiStateStore.getState().viewportBySheet.get(sheetId) ?? DEFAULT_VIEWPORT
    );
  }

  function blocks(): readonly Block[] {
    return (
      applicationStore.getState().documents.get(documentId)?.sheets.get(sheetId)
        ?.blocks ?? []
    );
  }

  function findBlock(blockId: BlockId): Block | undefined {
    return blocks().find((block) => block.blockId === blockId);
  }

  function selectedBlockIds(): readonly BlockId[] {
    const selection = getSelection(uiStateStore.getState(), sheetId);
    // Array order, so the command and the preview follow the z-order.
    return blocks()
      .map((block) => block.blockId)
      .filter((blockId) => selection.has(blockId));
  }

  function beginDrag(): void {
    const blockIds = selectedBlockIds();
    if (blockIds.length === 0) return;
    uiStateStore.setState((state) => startDrag(state, sheetId, blockIds));
  }

  function setPan(viewport: Viewport): void {
    uiStateStore.setState((state) => setViewport(state, sheetId, viewport));
  }

  function worldDeltaFrom(start: Point, point: Point): Point {
    return screenDeltaToWorld(pointDifference(point, start), currentViewport());
  }

  return {
    pointerDownOnBlock(blockId, point, additive) {
      if (committing) return;
      if (findBlock(blockId) === undefined) return;
      const before = getSelection(uiStateStore.getState(), sheetId);
      let narrowOnClick = false;
      if (additive) {
        uiStateStore.setState((state) =>
          toggleBlockSelection(state, sheetId, blockId),
        );
      } else if (!before.has(blockId)) {
        uiStateStore.setState((state) =>
          selectBlocks(state, sheetId, [blockId]),
        );
      } else {
        narrowOnClick = before.size > 1;
      }
      // Toggling the block off leaves nothing to drag from this press.
      const stillSelected = getSelection(uiStateStore.getState(), sheetId).has(
        blockId,
      );
      gesture = stillSelected
        ? { kind: "blockPress", blockId, start: point, narrowOnClick }
        : null;
    },

    pointerDownOnResizeHandle(blockId, point) {
      if (committing) return;
      if (findBlock(blockId) === undefined) return;
      uiStateStore.setState((state) => selectBlocks(state, sheetId, [blockId]));
      gesture = { kind: "handlePress", blockId, start: point };
    },

    pointerDownOnBackground(point, additive = false) {
      if (committing) return;
      gesture = { kind: "backgroundPress", start: point, additive };
    },

    pointerDownForPan(point) {
      if (committing) return;
      gesture = {
        kind: "panning",
        start: point,
        startViewport: currentViewport(),
      };
    },

    pointerMove(point) {
      if (gesture === null) return;
      switch (gesture.kind) {
        case "blockPress":
          if (!exceedsDragThreshold(gesture.start, point)) return;
          gesture = { kind: "dragging", start: gesture.start };
          beginDrag();
          break;
        case "handlePress": {
          if (!exceedsDragThreshold(gesture.start, point)) return;
          const block = findBlock(gesture.blockId);
          if (block === undefined) {
            gesture = null;
            return;
          }
          const startFrame = {
            x: block.position.x,
            y: block.position.y,
            width: block.size.width,
            height: block.size.height,
          };
          gesture = { kind: "resizing", start: gesture.start, startFrame };
          uiStateStore.setState((state) =>
            startResize(state, sheetId, block.blockId, startFrame),
          );
          break;
        }
        case "backgroundPress": {
          if (!exceedsDragThreshold(gesture.start, point)) return;
          // The rectangle starts where the press was, not where the threshold was passed.
          const startWorld = screenToWorld(gesture.start, currentViewport());
          const mode = gesture.additive ? "toggle" : "replace";
          gesture = { kind: "rangeSelecting" };
          uiStateStore.setState((state) =>
            startRangeSelection(state, sheetId, startWorld, mode),
          );
          break;
        }
        default:
          break;
      }
      switch (gesture?.kind) {
        case "dragging": {
          const delta = worldDeltaFrom(gesture.start, point);
          uiStateStore.setState((state) => updateDrag(state, delta));
          break;
        }
        case "resizing": {
          const frame = resizePreviewFrame(
            gesture.startFrame,
            worldDeltaFrom(gesture.start, point),
          );
          uiStateStore.setState((state) => updateResize(state, frame));
          break;
        }
        case "rangeSelecting": {
          const world = screenToWorld(point, currentViewport());
          uiStateStore.setState((state) => updateRangeSelection(state, world));
          break;
        }
        case "panning":
          setPan(
            panBy(gesture.startViewport, pointDifference(point, gesture.start)),
          );
          break;
        default:
          break;
      }
    },

    async pointerUp() {
      const finished = gesture;
      gesture = null;
      if (finished === null) return;
      switch (finished.kind) {
        case "blockPress":
          if (finished.narrowOnClick) {
            uiStateStore.setState((state) =>
              selectBlocks(state, sheetId, [finished.blockId]),
            );
          }
          return;
        case "backgroundPress":
          uiStateStore.setState((state) => clearSelection(state, sheetId));
          return;
        case "rangeSelecting": {
          const { interaction } = uiStateStore.getState();
          if (interaction.kind !== "rangeSelecting") return;
          const hit = blocksHitByRect(
            blocks(),
            normalizeRect(interaction.start, interaction.current),
          );
          const next = applyRangeHit(
            getSelection(uiStateStore.getState(), sheetId),
            hit,
            interaction.mode,
          );
          uiStateStore.setState((state) =>
            endInteraction(selectBlocks(state, sheetId, next)),
          );
          return;
        }
        case "dragging": {
          const { interaction } = uiStateStore.getState();
          if (interaction.kind !== "dragging") return;
          // The preview stays until the command has run: the command may wait behind an
          // in-flight save, and ending the preview first would show the block back at its
          // old position for that time. Ending it right after the commit (same task, no
          // paint in between) swaps preview and committed value without a jump.
          committing = true;
          try {
            await actions.commitDrag({
              documentId,
              sheetId: interaction.sheetId,
              blockIds: interaction.blockIds,
              worldDelta: interaction.delta,
            });
          } finally {
            committing = false;
            uiStateStore.setState(endInteraction);
          }
          return;
        }
        case "resizing": {
          const { interaction } = uiStateStore.getState();
          if (interaction.kind !== "resizing") return;
          // Same ordering as a drag: commit first, then drop the preview.
          committing = true;
          try {
            await actions.commitResize({
              documentId,
              sheetId: interaction.sheetId,
              blockId: interaction.blockId,
              frame: interaction.frame,
            });
          } finally {
            committing = false;
            uiStateStore.setState(endInteraction);
          }
          return;
        }
        default:
          return;
      }
    },

    cancel() {
      const cancelled = gesture;
      gesture = null;
      if (cancelled === null) return;
      uiStateStore.setState(endInteraction);
      // A cancelled pan goes back to where it started.
      if (cancelled.kind === "panning") setPan(cancelled.startViewport);
    },

    wheel({ point, deltaX, deltaY, zoom }) {
      // Changing the mapping mid-gesture would make the preview jump.
      if (gesture !== null || committing) return;
      const viewport = currentViewport();
      setPan(
        zoom
          ? zoomByWheel(viewport, point, deltaY)
          : panBy(viewport, { x: -deltaX, y: -deltaY }),
      );
    },

    isGestureActive: () => gesture !== null || committing,
  };
}
