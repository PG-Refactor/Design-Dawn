import type { ComponentType } from "react";
import type { Block } from "../../domain/block/block";
import type { BlockType } from "../../domain/block/block-type";
import { BlockPlaceholder } from "./block-placeholder";

export interface BlockRendererProps {
  readonly block: Block;
}

// One renderer per block type. Every type shows the placeholder until the Markdown /
// Mermaid / Image blocks exist (later phases replace the entries; the canvas itself has
// no block-type-specific code).
const BLOCK_RENDERERS: Readonly<
  Record<BlockType, ComponentType<BlockRendererProps>>
> = {
  markdown: BlockPlaceholder,
  mermaid: BlockPlaceholder,
  image: BlockPlaceholder,
};

export function BlockRenderer({ block }: BlockRendererProps) {
  const Renderer = BLOCK_RENDERERS[block.blockType];
  return <Renderer block={block} />;
}
