import { type KeyboardEvent, type PointerEvent, useRef } from "react";
import { clampProjectTreeWidth } from "../../application/local-state/project-tree-width";
import { LAYOUT_CONFIG } from "../../config/layout-config";
import { MESSAGES } from "./workspace-messages";
import "./project-tree-splitter.css";

const { minWidthPx, maxWidthPx, keyStepPx, largeKeyStepPx } =
  LAYOUT_CONFIG.projectTree;
const PRIMARY_BUTTON = 0;

interface DragState {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startWidth: number;
  // Measured once per drag: the window cannot change size under a captured pointer.
  readonly maxWidth: number;
  latestWidth: number;
}

export interface ProjectTreeSplitterProps {
  // The width currently shown (the stored one, or the live one while dragging).
  readonly width: number;
  // Upper limit right now: the configured maximum, reduced so the document area keeps
  // its minimum width.
  readonly measureMaxWidth: () => number;
  // Live width while the pointer moves; nothing is stored yet.
  readonly onPreview: (width: number) => void;
  // A finished gesture or key press: the caller stores the width.
  readonly onCommit: (width: number) => void;
  // The gesture was interrupted: the caller returns to the stored width.
  readonly onCancel: () => void;
  readonly onReset: () => void;
}

// Vertical separator between the Project Tree and the document area. A focusable
// separator with `aria-valuenow` is the WAI-ARIA window splitter pattern, so the width
// can be changed with the keyboard as well as the pointer.
export function ProjectTreeSplitter({
  width,
  measureMaxWidth,
  onPreview,
  onCommit,
  onCancel,
  onReset,
}: ProjectTreeSplitterProps) {
  // A ref, not state: pointer moves must see the latest drag without waiting for a render.
  const dragRef = useRef<DragState | null>(null);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== PRIMARY_BUTTON) return;
    const element = event.currentTarget;
    // Capture keeps the move events coming when the pointer leaves the thin separator
    // (or the window) during a fast drag.
    if (typeof element.setPointerCapture === "function") {
      element.setPointerCapture(event.pointerId);
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startWidth: width,
      maxWidth: measureMaxWidth(),
      latestWidth: width,
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const next = clampProjectTreeWidth(
      drag.startWidth + event.clientX - drag.startClientX,
      drag.maxWidth,
    );
    if (next === drag.latestWidth) return;
    drag.latestWidth = next;
    onPreview(next);
  }

  function finishDrag(
    event: PointerEvent<HTMLDivElement>,
    finish: (drag: DragState) => void,
  ) {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    const element = event.currentTarget;
    if (
      typeof element.hasPointerCapture === "function" &&
      element.hasPointerCapture(event.pointerId)
    ) {
      element.releasePointerCapture(event.pointerId);
    }
    finish(drag);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const step = event.shiftKey ? largeKeyStepPx : keyStepPx;
    let next: number;
    switch (event.key) {
      case "ArrowLeft":
        next = width - step;
        break;
      case "ArrowRight":
        next = width + step;
        break;
      case "Home":
        next = minWidthPx;
        break;
      case "End":
        next = maxWidthPx;
        break;
      default:
        return;
    }
    event.preventDefault();
    onCommit(clampProjectTreeWidth(next, measureMaxWidth()));
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be focusable or take aria-valuenow; this is the ARIA window splitter pattern.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={MESSAGES.splitter.label}
      aria-valuenow={width}
      aria-valuemin={minWidthPx}
      aria-valuemax={maxWidthPx}
      tabIndex={0}
      className="project-tree-splitter"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) =>
        finishDrag(event, (drag) => onCommit(drag.latestWidth))
      }
      onPointerCancel={(event) => finishDrag(event, onCancel)}
      onKeyDown={handleKeyDown}
      onDoubleClick={onReset}
    />
  );
}
