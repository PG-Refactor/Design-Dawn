// Results of the Project search (Rust reads the files; the app's open Documents are not
// involved). Offsets are in characters of `excerpt`.

import type { BlockType } from "../../domain/block/block-type";
import type {
  BlockId,
  DocumentId,
  SheetId,
} from "../../domain/shared/entity-id";

export const MATCH_PLACES = ["text", "caption"] as const;
export type MatchPlace = (typeof MATCH_PLACES)[number];

export interface SearchMatch {
  readonly documentId: DocumentId;
  readonly documentName: string;
  readonly sheetId: SheetId;
  readonly sheetName: string;
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly place: MatchPlace;
  readonly line: number;
  readonly excerpt: string;
  readonly matchStart: number;
  readonly matchLength: number;
}

export interface SearchResult {
  readonly matches: readonly SearchMatch[];
  // More matches exist than Rust returns.
  readonly truncated: boolean;
  // Blocks whose text could not be read.
  readonly unreadableBlocks: number;
}
