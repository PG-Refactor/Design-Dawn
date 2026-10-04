import type { ComponentType } from "react";
import type { Block } from "../../domain/block/block";
import type { BlockType } from "../../domain/block/block-type";
import type { DocumentId, SheetId } from "../../domain/shared/entity-id";
import { ImageBlock } from "../image/image-block";
import { MarkdownBlock } from "../markdown/markdown-block";
import { BlockPlaceholder } from "./block-placeholder";

export interface BlockRendererProps {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  readonly block: Block;
}

// One renderer per block type. Types without a real renderer show the placeholder (later
// phases replace the entries; the canvas itself has no block-type-specific code).
const BLOCK_RENDERERS: Readonly<
  Record<BlockType, ComponentType<BlockRendererProps>>
> = {
  markdown: MarkdownBlock,
  mermaid: BlockPlaceholder,
  image: ImageBlock,
};

export function BlockRenderer(props: BlockRendererProps) {
  const Renderer = BLOCK_RENDERERS[props.block.blockType];
  return <Renderer {...props} />;
}
