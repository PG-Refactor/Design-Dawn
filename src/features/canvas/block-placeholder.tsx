import type { BlockRendererProps } from "./block-renderer";
import { CANVAS_MESSAGES, shortBlockId } from "./canvas-messages";

// Shows what the block is until its type has a real renderer.
export function BlockPlaceholder({ block }: BlockRendererProps) {
  const labels = CANVAS_MESSAGES.placeholder;
  return (
    <dl className="block-placeholder">
      <dt>{labels.type}</dt>
      <dd>{block.blockType}</dd>
      <dt>{labels.id}</dt>
      <dd>{shortBlockId(block.blockId)}</dd>
      <dt>{labels.position}</dt>
      <dd>{`${block.position.x}, ${block.position.y}`}</dd>
      <dt>{labels.size}</dt>
      <dd>{`${block.size.width} × ${block.size.height}`}</dd>
    </dl>
  );
}
