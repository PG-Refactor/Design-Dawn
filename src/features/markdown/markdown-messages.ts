// User-visible strings of the Markdown block, one catalog per display language.

import type { DisplayLanguage } from "../../config/language-config";
import type { Widen } from "../../shared/i18n/catalog-types";

const MARKDOWN_MESSAGES_JA = {
  loading: "読み込み中…",
  loadFailed: "本文を読み込めませんでした",
  loadFailedHint: "選択、移動、サイズ変更、削除はできます。編集はできません。",
  errorKind: "種別",
  errorDetails: "詳細",
  done: "完了",
  hidePreview: "プレビューを非表示",
  showPreview: "プレビューを表示",
  sourcePreviewDivider: "ソースとプレビューの境界",
  previewLabel: (shortId: string): string => `Markdownプレビュー（${shortId}）`,
  sourceLabel: (shortId: string): string => `Markdownソース（${shortId}）`,
  editorLabel: (shortId: string): string => `Markdown編集（${shortId}）`,
  table: {
    button: "表",
    menuLabel: "表の操作",
    insertRowAbove: "上に行を挿入",
    insertRowBelow: "下に行を挿入",
    deleteRow: "行を削除",
    moveRowUp: "行を上へ移動",
    moveRowDown: "行を下へ移動",
    insertColumnLeft: "左に列を挿入",
    insertColumnRight: "右に列を挿入",
    deleteColumn: "列を削除",
    moveColumnLeft: "列を左へ移動",
    moveColumnRight: "列を右へ移動",
    alignLeft: "列を左揃え",
    alignCenter: "列を中央揃え",
    alignRight: "列を右揃え",
    alignNone: "列の揃えを解除",
    format: "表を整形",
    headerRowHint: "見出しの行は削除・移動できません",
  },
} as const;

export type MarkdownMessages = Widen<typeof MARKDOWN_MESSAGES_JA>;

const MARKDOWN_MESSAGES_EN: MarkdownMessages = {
  loading: "Loading…",
  loadFailed: "The text could not be loaded",
  loadFailedHint:
    "You can still select, move, resize and delete the block, but not edit it.",
  errorKind: "Kind",
  errorDetails: "Details",
  done: "Done",
  hidePreview: "Hide Preview",
  showPreview: "Show Preview",
  sourcePreviewDivider: "Divider between source and preview",
  previewLabel: (shortId) => `Markdown preview (${shortId})`,
  sourceLabel: (shortId) => `Markdown source (${shortId})`,
  editorLabel: (shortId) => `Markdown editor (${shortId})`,
  table: {
    button: "Table",
    menuLabel: "Table",
    insertRowAbove: "Insert Row Above",
    insertRowBelow: "Insert Row Below",
    deleteRow: "Delete Row",
    moveRowUp: "Move Row Up",
    moveRowDown: "Move Row Down",
    insertColumnLeft: "Insert Column Left",
    insertColumnRight: "Insert Column Right",
    deleteColumn: "Delete Column",
    moveColumnLeft: "Move Column Left",
    moveColumnRight: "Move Column Right",
    alignLeft: "Align Column Left",
    alignCenter: "Align Column Center",
    alignRight: "Align Column Right",
    alignNone: "Clear Column Alignment",
    format: "Tidy Table",
    headerRowHint: "The header row cannot be deleted or moved",
  },
};

export const MARKDOWN_MESSAGES: Readonly<
  Record<DisplayLanguage, MarkdownMessages>
> = { ja: MARKDOWN_MESSAGES_JA, en: MARKDOWN_MESSAGES_EN };
