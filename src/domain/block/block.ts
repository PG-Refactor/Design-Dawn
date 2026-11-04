import { type DomainResult, ok } from "../shared/domain-result";
import type { BlockId } from "../shared/entity-id";
import { parseBlockId } from "../shared/entity-id";
import {
  type Position,
  parsePosition,
  parseSize,
  type RawPosition,
  type RawSize,
  type Size,
} from "../shared/geometry";
import { type BlockType, parseBlockType } from "./block-type";
import {
  type Caption,
  type CaptionPosition,
  parseCaption,
  parseCaptionPosition,
} from "./caption";
import { type ContentPath, parseContentPath } from "./content-path";

export interface Block {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly position: Position;
  readonly size: Size;
  readonly contentPath: ContentPath;
  // Absent: the Block has no caption.
  readonly caption?: Caption;
  // Absent: the default place (below the figure).
  readonly captionPosition?: CaptionPosition;
}

export interface RawBlock {
  readonly blockId: string;
  readonly blockType: string;
  readonly position: RawPosition;
  readonly size: RawSize;
  readonly contentPath: string;
  readonly caption?: string;
  readonly captionPosition?: string;
}

// Reports the first error in file-format key order.
export function parseBlock(raw: RawBlock): DomainResult<Block> {
  const blockId = parseBlockId(raw.blockId);
  if (!blockId.ok) return blockId;
  const blockType = parseBlockType(raw.blockType);
  if (!blockType.ok) return blockType;
  const position = parsePosition(raw.position);
  if (!position.ok) return position;
  const size = parseSize(raw.size);
  if (!size.ok) return size;
  const contentPath = parseContentPath(raw.contentPath);
  if (!contentPath.ok) return contentPath;
  const caption = raw.caption === undefined ? null : parseCaption(raw.caption);
  if (caption !== null && !caption.ok) return caption;
  const captionPosition =
    raw.captionPosition === undefined
      ? null
      : parseCaptionPosition(raw.captionPosition);
  if (captionPosition !== null && !captionPosition.ok) return captionPosition;
  return ok({
    blockId: blockId.value,
    blockType: blockType.value,
    position: position.value,
    size: size.value,
    contentPath: contentPath.value,
    ...(caption === null ? {} : { caption: caption.value }),
    ...(captionPosition === null
      ? {}
      : { captionPosition: captionPosition.value }),
  });
}
