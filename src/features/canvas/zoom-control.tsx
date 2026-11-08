import { type KeyboardEvent, useEffect, useState } from "react";
import { CANVAS_CONFIG } from "../../config/canvas-config";
import { useMessages } from "../workspace/use-messages";
import {
  nextZoomStep,
  parseZoomPercent,
  zoomPercentText,
} from "./geometry/zoom-steps";

const { zoomMin, zoomMax } = CANVAS_CONFIG.viewport;
const PERCENT = 100;

export interface ZoomControlProps {
  readonly zoom: number;
  // A new zoom inside the limits; the canvas keeps its centre in place.
  readonly onZoom: (zoom: number) => void;
}

// The sheet's zoom in the corner of the canvas: - / + (and the arrow keys in the field) go
// to the next stop, and the percentage can be typed (Enter or leaving the field applies it,
// Escape puts back what is shown). Outside the canvas element, so its clicks are not canvas gestures.
export function ZoomControl({ zoom, onZoom }: ZoomControlProps) {
  const messages = useMessages().canvas.zoom;
  const shown = zoomPercentText(zoom);
  const [draft, setDraft] = useState(shown);
  // The zoom changed elsewhere (wheel, buttons): the field follows unless being typed in.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(shown);
  }, [shown, editing]);

  function apply(): void {
    const next = parseZoomPercent(draft);
    if (next !== null) onZoom(next);
    // A refused value, or one that rounds to what is shown, puts the shown value back.
    setDraft(zoomPercentText(next ?? zoom));
  }

  function step(direction: "in" | "out"): void {
    const next = nextZoomStep(zoom, direction);
    if (next !== null) onZoom(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    // The spin button's own keys: one stop up / down.
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      step(event.key === "ArrowUp" ? "in" : "out");
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      apply();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      // Not the canvas's or a dialog's Escape.
      event.stopPropagation();
      setDraft(shown);
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add form semantics to a small toolbar-like group.
    <div role="group" aria-label={messages.group} className="zoom-control">
      <button
        type="button"
        className="zoom-control__button"
        aria-label={messages.zoomOut}
        title={messages.zoomOut}
        disabled={zoom <= zoomMin}
        onClick={() => step("out")}
      >
        {messages.zoomOutText}
      </button>
      <label className="zoom-control__field">
        <input
          type="text"
          // A number that the arrow keys step (and that can be typed): a spin button.
          role="spinbutton"
          inputMode="decimal"
          className="zoom-control__input"
          aria-label={messages.input}
          aria-valuenow={Math.round(zoom * PERCENT)}
          aria-valuemin={Math.round(zoomMin * PERCENT)}
          aria-valuemax={Math.round(zoomMax * PERCENT)}
          value={draft}
          onFocus={(event) => {
            setEditing(true);
            event.currentTarget.select();
          }}
          onBlur={() => {
            setEditing(false);
            apply();
          }}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <span aria-hidden="true">%</span>
      </label>
      <button
        type="button"
        className="zoom-control__button"
        aria-label={messages.zoomIn}
        title={messages.zoomIn}
        disabled={zoom >= zoomMax}
        onClick={() => step("in")}
      >
        {messages.zoomInText}
      </button>
    </div>
  );
}
