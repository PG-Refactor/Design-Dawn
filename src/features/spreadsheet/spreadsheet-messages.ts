// User-visible strings of the spreadsheet import dialog, one catalog per display language.

import type { DisplayLanguage } from "../../config/language-config";
import type { Widen } from "../../shared/i18n/catalog-types";

const SPREADSHEET_MESSAGES_JA = {
  title: (file: string): string => `表計算ファイルから表（${file}）`,
  sheetsLegend: "取り込むシート（1つにつき1つのブロック）",
  hiddenSheet: "非表示",
  rangeLabel: (sheet: string): string => `${sheet} の範囲`,
  rangePlaceholder: "範囲（例: B3:H40。空欄は全体）",
  invalidRange: "範囲は B3:H40 のように書いてください。",
  previewOf: (sheet: string): string => `${sheet} をプレビュー`,
  importSheet: (sheet: string): string => `${sheet} を取り込む`,
  selectAll: "すべて選択",
  deselectAll: "すべて選択解除",
  optionsLegend: "取り込み方",
  headerRow: "1行目を見出しにする（しないときは列の記号 A, B, … が見出し）",
  fillMerged:
    "結合セルのすべてのセルに値を入れる（しないときは先頭のセルだけ）",
  alignNumbers: "数値だけの列を右寄せにする",
  skipHidden: "非表示の行・列・シートを除く",
  previewHeading: (sheet: string): string => `プレビュー: ${sheet}`,
  previewSize: (rows: number, columns: number): string =>
    `${rows} 行 × ${columns} 列（見出しを除く）`,
  previewMore: (rows: number): string => `ほか ${rows} 行`,
  previewEmpty: "取り込む値がありません。",
  truncated: "大きすぎるため、1000 行・50 列を超える部分は取り込みません。",
  cancel: "キャンセル",
  importButton: "取り込む",
} as const;

export type SpreadsheetMessages = Widen<typeof SPREADSHEET_MESSAGES_JA>;

const SPREADSHEET_MESSAGES_EN: SpreadsheetMessages = {
  title: (file) => `Table from Spreadsheet (${file})`,
  sheetsLegend: "Sheets to import (one block each)",
  hiddenSheet: "hidden",
  rangeLabel: (sheet) => `Range of ${sheet}`,
  rangePlaceholder: "Range (e.g. B3:H40; empty for all)",
  invalidRange: "Write a range like B3:H40.",
  previewOf: (sheet) => `Preview ${sheet}`,
  importSheet: (sheet) => `Import ${sheet}`,
  selectAll: "Select All",
  deselectAll: "Deselect All",
  optionsLegend: "How to import",
  headerRow: "First row is the header (otherwise the column letters A, B, …)",
  fillMerged:
    "Fill every cell of a merged area with its value (otherwise only the first)",
  alignNumbers: "Right-align columns that hold only numbers",
  skipHidden: "Leave out hidden rows, columns and sheets",
  previewHeading: (sheet) => `Preview: ${sheet}`,
  previewSize: (rows, columns) =>
    `${rows} ${rows === 1 ? "row" : "rows"} × ${columns} ${columns === 1 ? "column" : "columns"} (besides the header)`,
  previewMore: (rows) => (rows === 1 ? "1 more row" : `${rows} more rows`),
  previewEmpty: "There are no values to import.",
  truncated:
    "It is too large: beyond 1000 rows and 50 columns nothing is imported.",
  cancel: "Cancel",
  importButton: "Import",
};

export const SPREADSHEET_MESSAGES: Readonly<
  Record<DisplayLanguage, SpreadsheetMessages>
> = { ja: SPREADSHEET_MESSAGES_JA, en: SPREADSHEET_MESSAGES_EN };
