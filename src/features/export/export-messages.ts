// User-visible strings of the exports and the print dialog.

import type { DisplayLanguage } from "../../config/language-config";
import type { Widen } from "../../shared/i18n/catalog-types";

const EXPORT_MESSAGES_JA = {
  sheetHtml: "表示中のシートをHTMLとして書き出す…",
  documentHtml: "表示中のDocumentをHTMLとして書き出す…",
  print: "印刷…",
  printTitle: "印刷",
  showPageBreaks: "改ページ位置を表示",
  printPaperNote:
    "キャンバスの改ページ位置（表示メニュー）は、ここで選んだ用紙で表示されます。",
  printDescription:
    "OSの印刷画面が開きます。PDFにするときは、プリンターに「PDFとして保存」（Windows）などを選んでください。",
  target: "印刷するもの",
  targetSheet: "表示中のシート",
  targetDocument: "Document全体（シートの順に）",
  mode: "ページの作り方",
  modeFit: "シートごとに1ページ（内容の大きさのまま。画面で読む・PDF向け）",
  modePaper: "用紙に分けて印刷（各ページの上にシート名）",
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
  documentsMenu: "複数のDocumentを書き出す…",
  documentsTitle: "複数のDocumentを書き出す",
  documentsDescription:
    "選んだDocumentを、1つにつき1ファイルとして同じフォルダへ書き出します。ファイル名はDocumentの名前です。",
  documentsLegend: "書き出すDocument",
  selectAll: "すべて選択",
  selectNone: "すべて解除",
  formatLegend: "形式",
  formatMarkdown: "Markdown（.md。画像は「名前-assets」フォルダへ）",
  formatHtml:
    "HTML（1つのファイルに画像も入れる。ブロックはキャンバスの配置のまま）",
  formatPdf:
    "PDF（印刷画面を使わずに作る。シートごとに1ページ、内容の大きさのまま）",
  chooseFolder: "フォルダを選んで書き出す…",
  noDocumentChosen: "書き出すDocumentを1つ以上選んでください。",
  replaceQuestion: (folder: string): string =>
    `「${folder}」には次のファイルがすでにあります。置き換えて書き出しますか？`,
  replaceAndExport: "置き換えて書き出す",
  back: "戻る",
  exporting: (done: number, total: number): string =>
    `書き出し中… ${done} / ${total}`,
  exported: (count: number, folder: string): string =>
    `${count} 件を「${folder}」に書き出しました。`,
  notExported: "書き出せなかったDocument:",
  nothingToExport: "ブロックがありません",
  failedItem: (name: string, reason: string): string => `${name}（${reason}）`,
  close: "閉じる",
} as const;

export type ExportMessages = Widen<typeof EXPORT_MESSAGES_JA>;

const EXPORT_MESSAGES_EN: ExportMessages = {
  sheetHtml: "Export Sheet as HTML…",
  documentHtml: "Export Document as HTML…",
  print: "Print…",
  printTitle: "Print",
  showPageBreaks: "Show Page Breaks",
  printPaperNote:
    "The page breaks on the canvas (View menu) follow the paper chosen here.",
  printDescription:
    "The system print dialog opens. For a PDF, choose a PDF printer such as “Microsoft Print to PDF” or “Save as PDF”.",
  target: "What to print",
  targetSheet: "The shown sheet",
  targetDocument: "The whole Document (sheets in order)",
  mode: "Pages",
  modeFit: "One page per sheet, as large as its content (for reading and PDF)",
  modePaper: "Cut into paper pages (the sheet name on top of each)",
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
  documentsMenu: "Export Documents…",
  documentsTitle: "Export Documents",
  documentsDescription:
    "Writes each chosen Document as one file into the same folder, named after the Document.",
  documentsLegend: "Documents to export",
  selectAll: "Select All",
  selectNone: "Select None",
  formatLegend: "Format",
  formatMarkdown: "Markdown (.md; images go into a “name-assets” folder)",
  formatHtml:
    "HTML (one file with the images inside; blocks where they are on the canvas)",
  formatPdf:
    "PDF (made without the print dialog; one page per sheet, as large as its content)",
  chooseFolder: "Choose a Folder and Export…",
  noDocumentChosen: "Choose at least one Document to export.",
  replaceQuestion: (folder) =>
    `These files are already in “${folder}”. Replace them?`,
  replaceAndExport: "Replace and Export",
  back: "Back",
  exporting: (done, total) => `Exporting… ${done} of ${total}`,
  exported: (count, folder) =>
    count === 1
      ? `Exported 1 Document to “${folder}”.`
      : `Exported ${count} Documents to “${folder}”.`,
  notExported: "Not exported:",
  nothingToExport: "no blocks",
  failedItem: (name, reason) => `${name} (${reason})`,
  close: "Close",
};

export const EXPORT_MESSAGES: Readonly<
  Record<DisplayLanguage, ExportMessages>
> = { ja: EXPORT_MESSAGES_JA, en: EXPORT_MESSAGES_EN };
