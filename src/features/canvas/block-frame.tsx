import { memo } from "react";
import type { Block } from "../../domain/block/block";
import { BlockRenderer } from "./block-renderer";
import { blockAccessibleName, resizeHandleLabel } from "./canvas-messages";
import "./block-frame.css";

// The attributes the canvas reads from the DOM to find out what a pointer event hit.
export const BLOCK_ID_ATTRIBUTE = "data-block-id";
export const RESIZE_HANDLE_ATTRIBUTE = "data-canvas-handle";

export interface BlockFrameProps {
  readonly block: Block;
  readonly selected: boolean;
  readonly interacting: boolean;
  // World rectangle to draw at: the Domain value or a drag / resize preview. Primitives,
  // so unchanged blocks skip rendering while another block is being dragged.
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// Positions one block in the world layer and hosts its selection state and resize handle.
// The handle is a sibling of the option because an option's children are presentational.
export const BlockFrame = memo(function BlockFrame({
  block,
  selected,
  interacting,
  x,
  y,
  width,
  height,
}: BlockFrameProps) {
  const classNames = ["block-frame"];
  if (selected) classNames.push("block-frame--selected");
  if (interacting) classNames.push("block-frame--interacting");
  return (
    <div
      className={classNames.join(" ")}
      {...{ [BLOCK_ID_ATTRIBUTE]: block.blockId }}
      style={{ left: x, top: y, width, height }}
    >
      <div
        role="option"
        aria-selected={selected}
        aria-label={blockAccessibleName(block)}
        // Focusable by script and click only; keyboard events bubble to the canvas.
        tabIndex={-1}
        className="block-frame__body"
      >
        <BlockRenderer block={block} />
      </div>
      <button
        type="button"
        tabIndex={-1}
        aria-label={resizeHandleLabel(block)}
        className="block-frame__resize-handle"
        {...{ [RESIZE_HANDLE_ATTRIBUTE]: "" }}
      />
    </div>
  );
});
