import type { BlockType } from "../../domain/block/block-type";

// What the canvas may do with a block of each type. Pure data (no React), so actions and
// tests can use it; the canvas itself never branches on a type identifier.
const BLOCK_CAPABILITIES: Readonly<
  Record<BlockType, { readonly editable: boolean }>
> = {
  // Has an inline editor the canvas switches to (double-click / Enter).
  markdown: { editable: true },
  mermaid: { editable: true },
  image: { editable: false },
};

export function isEditableBlockType(blockType: BlockType): boolean {
  return BLOCK_CAPABILITIES[blockType].editable;
}
