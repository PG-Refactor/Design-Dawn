import type { BlockType } from "../../domain/block/block-type";

// What the canvas may do with a block of each type. Pure data (no React), so actions and
// tests can use it; the canvas itself never branches on a type identifier.
const BLOCK_CAPABILITIES: Readonly<
  Record<
    BlockType,
    { readonly editable: boolean; readonly captionable: boolean }
  >
> = {
  // editable: has an inline editor the canvas switches to (double-click / Enter).
  // captionable: a figure, which can have a caption line under it.
  markdown: { editable: true, captionable: false },
  mermaid: { editable: true, captionable: true },
  image: { editable: false, captionable: true },
};

export function isEditableBlockType(blockType: BlockType): boolean {
  return BLOCK_CAPABILITIES[blockType].editable;
}

export function isCaptionableBlockType(blockType: BlockType): boolean {
  return BLOCK_CAPABILITIES[blockType].captionable;
}
