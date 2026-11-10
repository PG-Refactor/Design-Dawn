// User-visible strings of the exports and the print dialog.

import type { DisplayLanguage } from "../../config/language-config";
import type { Widen } from "../../shared/i18n/catalog-types";

const EXPORT_MESSAGES_JA = {
  sheetHtml: "表示中のシートをHTMLとして書き出す…",
  documentHtml: "表示中のDocumentをHTMLとして書き出す…",
  print: "印刷 / PDFに保存…",
  printTitle: "印刷 / PDFに保存",
  printDescription:
    "OSの印刷画面が開きます。PDFにするときは、プリンターに「PDFとして保存」（Windows）などを選んでください。",
  target: "印刷するもの",
  targetSheet: "表示中のシート",
  targetDocument: "Document全体（シートの順に）",
  mode: "ページの作り方",
  modeFit: "シートごとに1ページ（内容の大きさのまま。画面で読む・PDF向け）",
  modePaper: "用紙に分けて印刷",
  paperSize: "用紙",
  orientation: "向き",
  portrait: "縦",
  landscape: "横",
  scale: "倍率",
  scaleActual: "100%",
  scaleFitWidth: "幅を1ページに合わせる",
  scaleFitPage: "全体を1ページに合わせる",
  preparing: "準備中…",
  printButton: "印刷…",
  printAnyway: "このまま印刷…",
  cancel: "キャンセル",
  overflowWarning: (count: number): string =>
    `${count} 個のブロックは内容が枠に収まっていないため、はみ出した部分は印刷されません。ブロックを大きくするか、このまま印刷してください。`,
  emptyWarning: "印刷するブロックがありません。",
} as const;

export type ExportMessages = Widen<typeof EXPORT_MESSAGES_JA>;

const EXPORT_MESSAGES_EN: ExportMessages = {
  sheetHtml: "Export Sheet as HTML…",
  documentHtml: "Export Document as HTML…",
  print: "Print / Save as PDF…",
  printTitle: "Print / Save as PDF",
  printDescription:
    "The system print dialog opens. For a PDF, choose a PDF printer such as “Microsoft Print to PDF” or “Save as PDF”.",
  target: "What to print",
  targetSheet: "The shown sheet",
  targetDocument: "The whole Document (sheets in order)",
  mode: "Pages",
  modeFit: "One page per sheet, as large as its content (for reading and PDF)",
  modePaper: "Cut into paper pages",
  paperSize: "Paper",
  orientation: "Orientation",
  portrait: "Portrait",
  landscape: "Landscape",
  scale: "Scale",
  scaleActual: "100%",
  scaleFitWidth: "Fit width to one page",
  scaleFitPage: "Fit everything on one page",
  preparing: "Preparing…",
  printButton: "Print…",
  printAnyway: "Print Anyway…",
  cancel: "Cancel",
  overflowWarning: (count) =>
    count === 1
      ? "1 block does not fit its frame; the part outside it is not printed. Make the block larger, or print anyway."
      : `${count} blocks do not fit their frames; the parts outside them are not printed. Make the blocks larger, or print anyway.`,
  emptyWarning: "There are no blocks to print.",
};

export const EXPORT_MESSAGES: Readonly<
  Record<DisplayLanguage, ExportMessages>
> = { ja: EXPORT_MESSAGES_JA, en: EXPORT_MESSAGES_EN };
