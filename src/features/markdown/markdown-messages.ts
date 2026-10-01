// User-visible strings of the Markdown block (Japanese UI, like the other feature
// message modules).

import type { BlockId } from "../../domain/shared/entity-id";
import { shortBlockId } from "../canvas/canvas-messages";

export const MARKDOWN_MESSAGES = {
  loading: "読み込み中…",
  loadFailed: "本文を読み込めませんでした",
  loadFailedHint: "選択、移動、サイズ変更、削除はできます。編集はできません。",
  errorKind: "種別",
  errorDetails: "詳細",
  done: "完了",
} as const;

export function previewLabel(blockId: BlockId): string {
  return `Markdownプレビュー（${shortBlockId(blockId)}）`;
}

export function sourceLabel(blockId: BlockId): string {
  return `Markdownソース（${shortBlockId(blockId)}）`;
}

export function editorLabel(blockId: BlockId): string {
  return `Markdown編集（${shortBlockId(blockId)}）`;
}
