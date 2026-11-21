// The full text of a label that is cut short with "…": shown, in the theme's colours,
// below and to the right of the pointer while it rests on the label. Nothing is shown when
// the label fits, and the hint is only a visual aid (the label keeps the whole text for
// screen readers), so it is hidden from assistive technology.

import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { LAYOUT_CONFIG } from "../../config/layout-config";
import "./overflow-hint.css";

const HINT = LAYOUT_CONFIG.overflowHint;

interface PointerPoint {
  readonly x: number;
  readonly y: number;
}

// Where the hint goes: offset from the pointer, moved back inside the window when it would
// pass the right or bottom edge (to the left of / above the pointer then).
export function hintPosition(
  pointer: PointerPoint,
  hintSize: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
): PointerPoint {
  const fitsRight =
    pointer.x + HINT.pointerOffsetPx + hintSize.width + HINT.edgeMarginPx <=
    viewport.width;
  const fitsBelow =
    pointer.y + HINT.pointerOffsetPx + hintSize.height + HINT.edgeMarginPx <=
    viewport.height;
  const x = fitsRight
    ? pointer.x + HINT.pointerOffsetPx
    : pointer.x - HINT.pointerOffsetPx - hintSize.width;
  const y = fitsBelow
    ? pointer.y + HINT.pointerOffsetPx
    : pointer.y - HINT.pointerOffsetPx - hintSize.height;
  return {
    x: Math.max(HINT.edgeMarginPx, x),
    y: Math.max(HINT.edgeMarginPx, y),
  };
}

function isCutShort(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth;
}

interface OverflowHintProps {
  readonly text: string;
  readonly id?: string;
  readonly className: string;
  readonly children: ReactNode;
}

export function OverflowHintLabel({
  text,
  id,
  className,
  children,
}: OverflowHintProps): ReactNode {
  const labelElement = useRef<HTMLSpanElement | null>(null);
  const hintElement = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);
  const lastPointer = useRef<PointerPoint>({ x: 0, y: 0 });
  const [shownAt, setShownAt] = useState<PointerPoint | null>(null);
  const [placed, setPlaced] = useState<PointerPoint | null>(null);

  function cancelTimer(): void {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }

  function hide(): void {
    cancelTimer();
    setShownAt(null);
    setPlaced(null);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLSpanElement>): void {
    lastPointer.current = { x: event.clientX, y: event.clientY };
    if (shownAt !== null) {
      // Follows the pointer while it moves on the label.
      setShownAt(lastPointer.current);
      return;
    }
    cancelTimer();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const label = labelElement.current;
      if (label !== null && isCutShort(label)) setShownAt(lastPointer.current);
    }, HINT.delayMs);
  }

  // Measured before painting, so the hint never flashes at the wrong place.
  useLayoutEffect(() => {
    const hint = hintElement.current;
    if (shownAt === null || hint === null) return;
    setPlaced(
      hintPosition(
        shownAt,
        { width: hint.offsetWidth, height: hint.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [shownAt]);

  // Scrolling, a click, a key or a resized window (the label may fit now) moves the label
  // away from the pointer or changes it: the hint goes.
  useEffect(() => {
    if (shownAt === null) return undefined;
    const dismiss = () => hide();
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("keydown", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("keydown", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  });

  // A label that goes away (the tree changed) leaves no timer behind.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <>
      <span
        ref={labelElement}
        id={id}
        className={className}
        onPointerMove={handlePointerMove}
        onPointerLeave={hide}
      >
        {children}
      </span>
      {shownAt === null
        ? null
        : createPortal(
            <div
              ref={hintElement}
              className="overflow-hint"
              aria-hidden="true"
              style={
                placed === null
                  ? { visibility: "hidden" }
                  : { left: placed.x, top: placed.y }
              }
            >
              {text}
            </div>,
            document.body,
          )}
    </>
  );
}
