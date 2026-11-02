// Coordinate math of the free-form canvas. Pure functions: no
// React, no DOM.
//
//   screen = world * zoom + pan
//
// `screen` is measured in pixels from the top-left corner of the canvas element; `world`
// is the coordinate space of Block positions / sizes. Everything returned as a viewport
// has passed `parseViewport`, so only valid viewports can become state.

import {
  parseViewport,
  type RawViewport,
  type Viewport,
} from "../../../application/local-state/viewport";
import { CANVAS_CONFIG } from "../../../config/canvas-config";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Extent {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const { panLimit, zoomMin, zoomMax } = CANVAS_CONFIG.viewport;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Non-finite input (NaN from a broken pointer event) falls back instead of propagating.
function clampOrFallback(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  return Number.isFinite(value) ? clampNumber(value, min, max) : fallback;
}

// Clamps to the limits shared with Rust and the local state parser, then re-validates
// through the parser so the brand is earned, not asserted.
export function clampViewport(raw: RawViewport): Viewport {
  const fallback = CANVAS_CONFIG.viewport.default;
  const parsed = parseViewport({
    panX: clampOrFallback(raw.panX, -panLimit, panLimit, fallback.panX),
    panY: clampOrFallback(raw.panY, -panLimit, panLimit, fallback.panY),
    zoom: clampOrFallback(raw.zoom, zoomMin, zoomMax, fallback.zoom),
  });
  if (!parsed.ok) {
    // Unreachable unless the configured limits themselves are inconsistent.
    throw new Error(`clamped viewport is invalid: ${parsed.error.detail}`);
  }
  return parsed.value;
}

// Evaluated once: the configured default must itself be a valid viewport.
export const DEFAULT_VIEWPORT: Viewport = clampViewport(
  CANVAS_CONFIG.viewport.default,
);

export function worldToScreen(world: Point, viewport: Viewport): Point {
  return {
    x: world.x * viewport.zoom + viewport.panX,
    y: world.y * viewport.zoom + viewport.panY,
  };
}

export function screenToWorld(screen: Point, viewport: Viewport): Point {
  return {
    x: (screen.x - viewport.panX) / viewport.zoom,
    y: (screen.y - viewport.panY) / viewport.zoom,
  };
}

export function worldSizeToScreen(size: Extent, viewport: Viewport): Extent {
  return {
    width: size.width * viewport.zoom,
    height: size.height * viewport.zoom,
  };
}

// A distance (pointer movement) has no pan component.
export function screenDeltaToWorld(delta: Point, viewport: Viewport): Point {
  return { x: delta.x / viewport.zoom, y: delta.y / viewport.zoom };
}

export function worldRectToScreen(rect: Rect, viewport: Viewport): Rect {
  return {
    ...worldToScreen(rect, viewport),
    ...worldSizeToScreen(rect, viewport),
  };
}

// The transform of the world layer; with `transform-origin: 0 0` it implements the
// formula above in the browser.
export function worldLayerTransform(viewport: Viewport): string {
  return `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`;
}

export function visibleWorldRect(
  viewportSize: Extent,
  viewport: Viewport,
): Rect {
  return {
    ...screenToWorld({ x: 0, y: 0 }, viewport),
    width: viewportSize.width / viewport.zoom,
    height: viewportSize.height / viewport.zoom,
  };
}

export function viewportCenterWorld(
  viewportSize: Extent,
  viewport: Viewport,
): Point {
  return screenToWorld(
    { x: viewportSize.width / 2, y: viewportSize.height / 2 },
    viewport,
  );
}

export function panBy(viewport: Viewport, screenDelta: Point): Viewport {
  return clampViewport({
    panX: viewport.panX + screenDelta.x,
    panY: viewport.panY + screenDelta.y,
    zoom: viewport.zoom,
  });
}

// Keeps the world point under `screenPoint` where it is on screen. The zoom is clamped
// first so the anchor stays fixed at the limits too (the pan is derived from the zoom
// that is actually applied).
export function zoomAt(
  viewport: Viewport,
  screenPoint: Point,
  nextZoom: number,
): Viewport {
  // Infinity (an extreme wheel delta) clamps to the limit; only NaN keeps the zoom.
  const zoom = Number.isNaN(nextZoom)
    ? viewport.zoom
    : clampNumber(nextZoom, zoomMin, zoomMax);
  const anchor = screenToWorld(screenPoint, viewport);
  return clampViewport({
    panX: screenPoint.x - anchor.x * zoom,
    panY: screenPoint.y - anchor.y * zoom,
    zoom,
  });
}

// Wheel up (negative delta) zooms in.
export function zoomByWheel(
  viewport: Viewport,
  screenPoint: Point,
  wheelDelta: number,
): Viewport {
  const factor = Math.exp(-wheelDelta * CANVAS_CONFIG.zoom.wheelStep);
  return zoomAt(viewport, screenPoint, viewport.zoom * factor);
}
