// User-visible strings of the canvas (Japanese UI, like `workspace-messages.ts`).

import { CANVAS_CONFIG } from "../../config/canvas-config";
import type { Block } from "../../domain/block/block";
import type { BlockId } from "../../domain/shared/entity-id";

export const CANVAS_MESSAGES = {
  noSheet: "表示できるSheetがありません。Sheetを作成してください。",
  toolbar: {
    label: "Canvasツールバー",
    addBlock: "+ Block",
    blockTypeMenuLabel: "追加するBlockの種類",
  },
  placeholder: {
    type: "種類",
    id: "ID",
    position: "位置",
    size: "サイズ",
  },
} as const;

export function shortBlockId(blockId: BlockId): string {
  return blockId.slice(-CANVAS_CONFIG.block.shortIdLength);
}

export function blockAccessibleName(block: Block): string {
  return `${block.blockType} ${shortBlockId(block.blockId)}`;
}

export function resizeHandleLabel(block: Block): string {
  return `${blockAccessibleName(block)} のサイズを変更`;
}
