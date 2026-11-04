// User-visible strings of the canvas, one catalog per display language (like the other
// feature message modules).

import { CANVAS_CONFIG } from "../../config/canvas-config";
import type { DisplayLanguage } from "../../config/language-config";
import type { Block } from "../../domain/block/block";
import type { BlockId } from "../../domain/shared/entity-id";
import type { Widen } from "../../shared/i18n/catalog-types";

const CANVAS_MESSAGES_JA = {
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
  contextMenu: {
    blockLabel: "Blockのメニュー",
    canvasLabel: "Canvasのメニュー",
    addBlock: (typeLabel: string): string => `${typeLabel} Blockを追加`,
    edit: "編集",
    cut: "切り取り",
    copy: "コピー",
    paste: "貼り付け",
    duplicate: "複製",
    delete: "削除",
    editCaption: "キャプションを編集…",
  },
  caption: {
    dialogTitle: "キャプション",
    fieldLabel: "図の下に表示する1行のテキスト",
    hint: "空にするとキャプションを消します。",
    save: "保存",
    invalid: "キャプションは1行・500文字までで入力してください。",
  },
  dropHint: "ここに画像をドロップ",
  resizeHandleLabel: (blockName: string): string =>
    `${blockName} のサイズを変更`,
} as const;

export type CanvasMessages = Widen<typeof CANVAS_MESSAGES_JA>;

const CANVAS_MESSAGES_EN: CanvasMessages = {
  noSheet: "There is no Sheet to show. Create a Sheet.",
  toolbar: {
    label: "Canvas toolbar",
    addBlock: "+ Block",
    blockTypeMenuLabel: "Block type to add",
  },
  reorder: {
    menuButton: "Arrange",
    menuLabel: "Change stacking order",
    forward: "Bring Forward",
    backward: "Send Backward",
    toFront: "Bring to Front",
    toBack: "Send to Back",
  },
  align: {
    menuButton: "Align",
    menuLabel: "Align blocks",
    left: "Align Left",
    horizontalCenter: "Align Horizontal Center",
    right: "Align Right",
    top: "Align Top",
    verticalCenter: "Align Vertical Center",
    bottom: "Align Bottom",
  },
  contextMenu: {
    blockLabel: "Block menu",
    canvasLabel: "Canvas menu",
    addBlock: (typeLabel) => `Add ${typeLabel} Block`,
    edit: "Edit",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    duplicate: "Duplicate",
    delete: "Delete",
    editCaption: "Edit Caption…",
  },
  caption: {
    dialogTitle: "Caption",
    fieldLabel: "One line shown under the figure",
    hint: "Leave it empty to remove the caption.",
    save: "Save",
    invalid: "A caption is one line of up to 500 characters.",
  },
  dropHint: "Drop images here",
  resizeHandleLabel: (blockName) => `Resize ${blockName}`,
};

export const CANVAS_MESSAGES: Readonly<
  Record<DisplayLanguage, CanvasMessages>
> = { ja: CANVAS_MESSAGES_JA, en: CANVAS_MESSAGES_EN };

// The tail of the id is what names blocks everywhere; it is the same in every language.
export function shortBlockId(blockId: BlockId): string {
  return blockId.slice(-CANVAS_CONFIG.block.shortIdLength);
}

// Block type id and id tail: language independent, so it lives outside the catalogs.
export function blockAccessibleName(block: Block): string {
  return `${block.blockType} ${shortBlockId(block.blockId)}`;
}
