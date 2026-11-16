// User-visible strings of the exports and the print dialog.

import type { DisplayLanguage } from "../../config/language-config";
import type { Widen } from "../../shared/i18n/catalog-types";

const EXPORT_MESSAGES_JA = {
  print: "印刷…",
  printTitle: "印刷",
  unsavedBeforePrint:
    "このDocumentには保存していない変更があります。保存してから印刷しますか？",
  saveAndPrint: "保存して印刷…",
  printWithoutSaving: "保存せずに印刷…",
  closeWhilePrintingTitle: "印刷中です",
  closeWhilePrinting:
    "印刷の画面が開いています。印刷をやめて、このウィンドウを閉じますか？",
  closeAnyway: "印刷をやめて閉じる",
  showPageBreaks: "改ページ位置を表示",
  printPaperNote:
    "キャンバスの改ページ位置（表示メニュー）は、ここで選んだ用紙で表示されます。",
  printDescription:
    "印刷用のウィンドウが開き、そこで印刷の画面が出ます。PDFにするときは、プリンターに「Microsoft Print to PDF」などを選んでください。",
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
  exportMenuItem: "エクスポート",
  exportMarkdownItem: "Markdown…",
  exportHtmlItem: "HTML…",
  exportPdfItem: "PDF…",
  exportMarkdownTitle: "Markdownとして書き出す",
  exportHtmlTitle: "HTMLとして書き出す",
  exportPdfTitle: "PDFとして書き出す",
  scopeLegend: "書き出すもの",
  scopeSheet: (document: string, sheet: string): string =>
    `表示中のシート（${document} / ${sheet}）`,
  scopeSheetNone: "表示中のシート（表示中のシートがありません）",
  scopeDocument: (document: string): string =>
    `表示中のDocument（${document}）`,
  scopeDocumentNone: "表示中のDocument（表示中のDocumentがありません）",
  scopeChoose:
    "Documentを選ぶ（複数可。フォルダを選ぶと中のDocumentをすべて選ぶ）",
  folderEntry: (name: string): string => `${name}/`,
  keepFolders: "Projectのフォルダ構成を保って書き出す",
  exportFile: "書き出す…",
  savedAs: (file: string): string => `「${file}」に書き出しました。`,
  documentsLegend: "書き出すDocument",
  selectAll: "すべて選択",
  selectNone: "すべて解除",
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
  print: "Print…",
  printTitle: "Print",
  unsavedBeforePrint:
    "This Document has changes that are not saved. Save before printing?",
  saveAndPrint: "Save and Print…",
  printWithoutSaving: "Print Without Saving…",
  closeWhilePrintingTitle: "Printing",
  closeWhilePrinting:
    "A print window is open. Stop printing and close this window?",
  closeAnyway: "Stop Printing and Close",
  showPageBreaks: "Show Page Breaks",
  printPaperNote:
    "The page breaks on the canvas (View menu) follow the paper chosen here.",
  printDescription:
    "A print window opens with the print dialog. For a PDF, choose a PDF printer such as “Microsoft Print to PDF” or “Save as PDF”.",
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
  exportMenuItem: "Export",
  exportMarkdownItem: "Markdown…",
  exportHtmlItem: "HTML…",
  exportPdfItem: "PDF…",
  exportMarkdownTitle: "Export as Markdown",
  exportHtmlTitle: "Export as HTML",
  exportPdfTitle: "Export as PDF",
  scopeLegend: "What to export",
  scopeSheet: (document, sheet) => `The shown sheet (${document} / ${sheet})`,
  scopeSheetNone: "The shown sheet (no sheet is shown)",
  scopeDocument: (document) => `The shown Document (${document})`,
  scopeDocumentNone: "The shown Document (no Document is shown)",
  scopeChoose:
    "Choose Documents (several at once; a folder chooses everything in it)",
  folderEntry: (name) => `${name}/`,
  keepFolders: "Keep the Project's folder structure",
  exportFile: "Export…",
  savedAs: (file) => `Exported to “${file}”.`,
  documentsLegend: "Documents to export",
  selectAll: "Select All",
  selectNone: "Select None",
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
