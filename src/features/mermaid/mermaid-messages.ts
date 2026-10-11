// User-visible strings of the Mermaid block, one catalog per display language.

import type { DisplayLanguage } from "../../config/language-config";
import type { Widen } from "../../shared/i18n/catalog-types";

const MERMAID_MESSAGES_JA = {
  loading: "読み込み中…",
  loadFailed: "ソースを読み込めませんでした",
  loadFailedHint: "選択、移動、サイズ変更、削除はできます。編集はできません。",
  errorKind: "種別",
  errorDetails: "詳細",
  done: "完了",
  empty: "空の図です",
  rendering: "描画中…",
  renderFailed: "図を描画できません",
  editHint: "ダブルクリックで編集できます",
  diagramAlt: (shortId: string): string => `Mermaid図（${shortId}）`,
  previewLabel: (shortId: string): string => `Mermaidプレビュー（${shortId}）`,
  sourceLabel: (shortId: string): string => `Mermaidソース（${shortId}）`,
  editorLabel: (shortId: string): string => `Mermaid編集（${shortId}）`,
} as const;

export type MermaidMessages = Widen<typeof MERMAID_MESSAGES_JA>;

const MERMAID_MESSAGES_EN: MermaidMessages = {
  loading: "Loading…",
  loadFailed: "The source could not be loaded",
  loadFailedHint:
    "You can still select, move, resize and delete the block, but not edit it.",
  errorKind: "Kind",
  errorDetails: "Details",
  done: "Done",
  empty: "The diagram is empty",
  rendering: "Rendering…",
  renderFailed: "The diagram cannot be drawn",
  editHint: "Double-click to edit",
  diagramAlt: (shortId) => `Mermaid diagram (${shortId})`,
  previewLabel: (shortId) => `Mermaid preview (${shortId})`,
  sourceLabel: (shortId) => `Mermaid source (${shortId})`,
  editorLabel: (shortId) => `Mermaid editor (${shortId})`,
};

export const MERMAID_MESSAGES: Readonly<
  Record<DisplayLanguage, MermaidMessages>
> = { ja: MERMAID_MESSAGES_JA, en: MERMAID_MESSAGES_EN };
