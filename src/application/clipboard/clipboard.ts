// In-app clipboard. The port is the single boundary where an
// OS clipboard could be attached later; nothing here touches browser or OS APIs.

import type { CaptionFields } from "../../domain/block/caption";
import type { ContentPath } from "../../domain/block/content-path";
import type { DisplayStoredFields } from "../../domain/block/content-scale";
import type { DocumentId, SheetId } from "../../domain/shared/entity-id";
import type { Size } from "../../domain/shared/geometry";
import type { AssetBlockType, TextBlockType } from "../commands/command";

// A figure's caption (and its place) and a block's display size go with its copy.
interface ClipboardBlockBase extends CaptionFields, DisplayStoredFields {
  readonly size: Size;
  // Relative to the top-left corner of the copied group's bounding box.
  readonly offset: { readonly x: number; readonly y: number };
}

// A block with a text file: its content is copied by value, as of the moment of copying.
export interface TextClipboardBlock extends ClipboardBlockBase {
  readonly kind: "text";
  readonly blockType: TextBlockType;
  readonly text: string;
  // The file the text came from. Relative references in it (a Markdown image) are resolved
  // from there; absent for text that never had a file.
  readonly sourceContentPath?: ContentPath;
}

// A block that references an asset: only the Document-relative path is kept. Pasting into
// the same Document reuses the file; another Document gets a copy at paste time.
export interface AssetClipboardBlock extends ClipboardBlockBase {
  readonly kind: "asset";
  readonly blockType: AssetBlockType;
  readonly contentPath: ContentPath;
}

export type ClipboardBlock = TextClipboardBlock | AssetClipboardBlock;

// Where the content was copied from; decides how a paste is placed: next to the originals on the same sheet, centred in the view anywhere else.
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
