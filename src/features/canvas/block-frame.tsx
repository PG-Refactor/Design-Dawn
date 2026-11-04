import { memo } from "react";
import type { Block } from "../../domain/block/block";
import type { DocumentId, SheetId } from "../../domain/shared/entity-id";
import { useMessages } from "../workspace/use-messages";
import { isCaptionableBlockType } from "./block-capabilities";
import {
  BLOCK_BODY_ATTRIBUTE,
  BLOCK_ID_ATTRIBUTE,
  RESIZE_HANDLE_ATTRIBUTE,
} from "./block-dom";
import { BlockRenderer } from "./block-renderer";
import { blockAccessibleName } from "./canvas-messages";
import "./block-frame.css";

export interface BlockFrameProps {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
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
  documentId,
  sheetId,
  block,
  selected,
  interacting,
  x,
  y,
  width,
  height,
}: BlockFrameProps) {
  const messages = useMessages().canvas;
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
        {...{ [BLOCK_BODY_ATTRIBUTE]: "" }}
      >
        <BlockRenderer
          documentId={documentId}
          sheetId={sheetId}
          block={block}
        />
      </div>
      {/* A figure's caption: a line under it, inside the block's frame. */}
      {block.caption !== undefined &&
      isCaptionableBlockType(block.blockType) ? (
        <p className="block-frame__caption">{block.caption}</p>
      ) : null}
      <button
        type="button"
        tabIndex={-1}
        aria-label={messages.resizeHandleLabel(blockAccessibleName(block))}
        className="block-frame__resize-handle"
        {...{ [RESIZE_HANDLE_ATTRIBUTE]: "" }}
      />
    </div>
  );
});
