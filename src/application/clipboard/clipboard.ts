// In-app clipboard (docs/architecture.md §9.5). The port is the single boundary where an
// OS clipboard could be attached later; nothing here touches browser or OS APIs.

import type { BlockType } from "../../domain/block/block-type";
import type { Size } from "../../domain/shared/geometry";

export interface ClipboardBlock {
  readonly blockType: BlockType;
  readonly size: Size;
  // Relative to the top-left corner of the copied group's bounding box.
  readonly offset: { readonly x: number; readonly y: number };
  // Content as of the moment of copying.
  readonly text: string;
}

export interface ClipboardContent {
  // Back-to-front, so pasting in this order keeps the relative z-order.
  readonly blocks: readonly ClipboardBlock[];
}

export interface ClipboardPort {
  read(): ClipboardContent | null;
  write(content: ClipboardContent): void;
}

export function createInMemoryClipboard(): ClipboardPort {
  let content: ClipboardContent | null = null;
  return {
    read: () => content,
    write(next) {
      content = next;
    },
  };
}
