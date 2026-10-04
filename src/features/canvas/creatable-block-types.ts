import type { TextBlockType } from "../../application/commands/command";
import type { BlockType } from "../../domain/block/block-type";
import { MARKDOWN_BLOCK_DEFAULTS } from "../markdown/markdown-block-defaults";

export interface CreatableBlockType {
  readonly blockType: TextBlockType;
  // Shown in the "+ Block" menu.
  readonly label: string;
  // World units.
  readonly defaultSize: { readonly width: number; readonly height: number };
  readonly initialText: string;
}

// The block types the "+ Block" menu offers. A new type is one more row (only types that
// can actually be created belong here: no placeholders).
export const CREATABLE_BLOCK_TYPES: readonly CreatableBlockType[] = [
  {
    blockType: "markdown",
    label: "Markdown",
    defaultSize: MARKDOWN_BLOCK_DEFAULTS.size,
    initialText: MARKDOWN_BLOCK_DEFAULTS.initialText,
  },
];

export function findCreatableBlockType(
  blockType: BlockType,
): CreatableBlockType | undefined {
  return CREATABLE_BLOCK_TYPES.find(
    (candidate) => candidate.blockType === blockType,
  );
}
