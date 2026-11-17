// User-visible strings of the unused images dialog, one catalog per display language.

import type { DisplayLanguage } from "../../config/language-config";
import type { Widen } from "../../shared/i18n/catalog-types";

const UNUSED_ASSETS_MESSAGES_JA = {
  menuItem: "使われていない画像を整理…",
  title: (document: string): string => `使われていない画像（${document}）`,
  unsaved:
    "保存していない変更があります。保存したうえで、どのブロックにも使われていない画像を探します。",
  saveAndFind: "保存して探す",
  finding: "探しています…",
  none: "使われていない画像はありません。",
  description:
    "このDocumentの assets フォルダーにある画像のうち、どのブロックからも参照されていないものです。削除すると元に戻せません（Gitで管理していれば履歴から戻せます）。",
  heldByHistory: (count: number): string =>
    `ほかに ${count} 個、「元に戻す」で使われる可能性がある画像は一覧に含めていません。`,
  listLabel: "使われていない画像",
  selectAll: "すべて選択",
  deselectAll: "すべて選択解除",
  size: (kilobytes: string): string => `${kilobytes} KB`,
  deleteChosen: (count: number): string => `選んだ ${count} 個を削除`,
  deleting: "削除しています…",
  deleted: (count: number): string => `${count} 個の画像を削除しました。`,
  keptInUse: (count: number): string =>
    `${count} 個は一覧を出したあとで使われるようになったため、残しました。`,
  failed: "使われていない画像を探せませんでした。",
  deleteFailed: "画像を削除できませんでした。",
  cancel: "キャンセル",
  close: "閉じる",
};

export type UnusedAssetsMessages = Widen<typeof UNUSED_ASSETS_MESSAGES_JA>;

const UNUSED_ASSETS_MESSAGES_EN: UnusedAssetsMessages = {
  menuItem: "Clean Up Unused Images…",
  title: (document) => `Unused Images (${document})`,
  unsaved:
    "There are unsaved changes. They are saved first, then the images no block uses are looked for.",
  saveAndFind: "Save and Look",
  finding: "Looking…",
  none: "There are no unused images.",
  description:
    "Images in this Document's assets folder that no block refers to. Deleting cannot be undone (with Git, the history still has them).",
  heldByHistory: (count) =>
    `${count} more that Undo may bring back into use are not listed.`,
  listLabel: "Unused images",
  selectAll: "Select All",
  deselectAll: "Deselect All",
  size: (kilobytes) => `${kilobytes} KB`,
  deleteChosen: (count) => `Delete ${count} Chosen`,
  deleting: "Deleting…",
  deleted: (count) => `Deleted ${count} images.`,
  keptInUse: (count) =>
    `${count} came into use after the list was shown and were kept.`,
  failed: "Could not look for unused images.",
  deleteFailed: "Could not delete the images.",
  cancel: "Cancel",
  close: "Close",
};

export const UNUSED_ASSETS_MESSAGES: Readonly<
  Record<DisplayLanguage, UnusedAssetsMessages>
> = { ja: UNUSED_ASSETS_MESSAGES_JA, en: UNUSED_ASSETS_MESSAGES_EN };
