import { type DomainResult, err, ok } from "../shared/domain-result";
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
import {
  type ContentScalePercent,
  isScalableBlockType,
  parseContentScalePercent,
} from "./content-scale";

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
  // Markdown and Mermaid only. Absent: 100 percent.
  readonly contentScalePercent?: ContentScalePercent;
  // Markdown and Mermaid only. Absent: the type's default (`fitsByDefault`).
  readonly autoFit?: boolean;
}

export interface RawBlock {
  readonly blockId: string;
  readonly blockType: string;
  readonly position: RawPosition;
  readonly size: RawSize;
  readonly contentPath: string;
  readonly caption?: string;
  readonly captionPosition?: string;
  readonly contentScalePercent?: number;
  readonly autoFit?: boolean;
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
  const contentScalePercent =
    raw.contentScalePercent === undefined
      ? null
      : parseContentScalePercent(raw.contentScalePercent);
  if (contentScalePercent !== null && !contentScalePercent.ok) {
    return contentScalePercent;
  }
  if (
    (contentScalePercent !== null || raw.autoFit !== undefined) &&
    !isScalableBlockType(blockType.value)
  ) {
    return err("invalidContentScale", "an image Block has no display size");
  }
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
    ...(contentScalePercent === null
      ? {}
      : { contentScalePercent: contentScalePercent.value }),
    ...(raw.autoFit === undefined ? {} : { autoFit: raw.autoFit }),
  });
}
