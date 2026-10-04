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
  reorder: {
    menuButton: "重なり順",
    menuLabel: "重なり順の変更",
    forward: "前面へ",
    backward: "背面へ",
    toFront: "最前面へ",
    toBack: "最背面へ",
  },
  align: {
    menuButton: "整列",
    menuLabel: "Blockの整列",
    left: "左揃え",
    horizontalCenter: "左右中央揃え",
    right: "右揃え",
    top: "上揃え",
    verticalCenter: "上下中央揃え",
    bottom: "下揃え",
  },
  placeholder: {
    type: "種類",
    id: "ID",
    position: "位置",
    size: "サイズ",
  },
} as const;

// Subject of the notification for blocks that a copy / cut / duplicate had to leave out.
export function skippedBlocksSubject(count: number): string {
  return `${count}個のBlock`;
}

export function shortBlockId(blockId: BlockId): string {
  return blockId.slice(-CANVAS_CONFIG.block.shortIdLength);
}

export function blockAccessibleName(block: Block): string {
  return `${block.blockType} ${shortBlockId(block.blockId)}`;
}

export function resizeHandleLabel(block: Block): string {
  return `${blockAccessibleName(block)} のサイズを変更`;
}
