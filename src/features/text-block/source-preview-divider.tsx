import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useRef,
} from "react";
import { LAYOUT_CONFIG } from "../../config/layout-config";

const { defaultSourceShare, minSourceShare, maxSourceShare, keyStepShare } =
  LAYOUT_CONFIG.sourceEditor;
const PRIMARY_BUTTON = 0;
const PERCENT = 100;

export interface SourcePreviewDividerProps {
  readonly label: string;
  // The share of the editor's width the source takes now.
  readonly sourceShare: number;
  // The editor whose width the share is of (measured on screen, so the canvas zoom does
  // not matter: pointer and box are in the same pixels).
  readonly containerRef: RefObject<HTMLElement | null>;
  // A new share, possibly outside the limits (the receiver keeps it inside them).
  readonly onChange: (sourceShare: number) => void;
}

// The movable border between the source and the preview: the WAI-ARIA window splitter
// pattern (a focusable separator with a value), dragged with the pointer or moved with the
// arrow keys, Home and End. A double-click puts it back in the middle.
export function SourcePreviewDivider({
  label,
  sourceShare,
  containerRef,
  onChange,
}: SourcePreviewDividerProps) {
  const pointerRef = useRef<number | null>(null);

  function shareAt(clientX: number): number | null {
    const box = containerRef.current?.getBoundingClientRect();
    if (box === undefined || box.width <= 0) return null;
    return (clientX - box.left) / box.width;
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== PRIMARY_BUTTON) return;
    // Not a text selection or a block drag on the canvas.
    event.preventDefault();
    event.stopPropagation();
    pointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.focus();
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (pointerRef.current !== event.pointerId) return;
    const share = shareAt(event.clientX);
    if (share !== null) onChange(share);
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>): void {
    if (pointerRef.current !== event.pointerId) return;
    pointerRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    let next: number;
    switch (event.key) {
      case "ArrowLeft":
        next = sourceShare - keyStepShare;
        break;
      case "ArrowRight":
        next = sourceShare + keyStepShare;
        break;
      case "Home":
        next = minSourceShare;
        break;
      case "End":
        next = maxSourceShare;
        break;
      default:
        return;
    }
    event.preventDefault();
    // The canvas must not take the arrow keys as a block nudge.
    event.stopPropagation();
    onChange(next);
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be focusable or take aria-valuenow; this is the ARIA window splitter pattern.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(sourceShare * PERCENT)}
      aria-valuemin={Math.round(minSourceShare * PERCENT)}
      aria-valuemax={Math.round(maxSourceShare * PERCENT)}
      tabIndex={0}
      className="text-block-editor__divider"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => onChange(defaultSourceShare)}
    />
  );
}
