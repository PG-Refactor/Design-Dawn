// User-visible strings of the Image block (Japanese UI, like the other feature message
// modules).

import type { BlockId } from "../../domain/shared/entity-id";
import { shortBlockId } from "../canvas/canvas-messages";

export const IMAGE_MESSAGES = {
  loadFailed: "画像を読み込めません",
  pathLabel: "パス",
} as const;

// The file name is not used: the contentPath is shown in the error state instead, and the
// id tail is what names blocks everywhere else.
export function imageAltText(blockId: BlockId): string {
  return `画像（${shortBlockId(blockId)}）`;
}
