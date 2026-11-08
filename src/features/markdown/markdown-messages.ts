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
  hidePreview: "プレビューを隠す",
  showPreview: "プレビューを表示",
  sourcePreviewDivider: "ソースとプレビューの境界",
  previewLabel: (shortId: string): string => `Markdownプレビュー（${shortId}）`,
  sourceLabel: (shortId: string): string => `Markdownソース（${shortId}）`,
  editorLabel: (shortId: string): string => `Markdown編集（${shortId}）`,
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
};

export const MARKDOWN_MESSAGES: Readonly<
  Record<DisplayLanguage, MarkdownMessages>
> = { ja: MARKDOWN_MESSAGES_JA, en: MARKDOWN_MESSAGES_EN };
