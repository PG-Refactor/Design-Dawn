// In-app clipboard (docs/architecture.md §9.5). The port is the single boundary where an
// OS clipboard could be attached later; nothing here touches browser or OS APIs.

import type { BlockType } from "../../domain/block/block-type";
import type { DocumentId, SheetId } from "../../domain/shared/entity-id";
import type { Size } from "../../domain/shared/geometry";

export interface ClipboardBlock {
  readonly blockType: BlockType;
  readonly size: Size;
  // Relative to the top-left corner of the copied group's bounding box.
  readonly offset: { readonly x: number; readonly y: number };
  // Content as of the moment of copying.
  readonly text: string;
}

// Where the content was copied from; decides how a paste is placed (docs/architecture.md
// §9.5): next to the originals on the same sheet, centred in the view anywhere else.
export interface ClipboardSource {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
  // Top-left of the copied group's bounding box in world coordinates.
  readonly origin: { readonly x: number; readonly y: number };
}

export interface ClipboardContent {
  readonly source: ClipboardSource;
  // Same-sheet pastes done from this content so far; each one steps further from the
  // originals so repeated pastes do not stack on each other.
  readonly pasteCount: number;
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
