// One self-contained HTML page of sheets: every block at its place, Markdown as the
// sanitised HTML the app shows, diagrams and images as data URLs. No script, no external
// file. The same page is used for the HTML export and, with page rules, for printing.

import { PRINT_CONFIG } from "../../config/print-config";
import {
  contentBounds,
  drawnPictureRect,
  type Rect,
} from "../../domain/print/page-layout";
import {
  PAPER_SIZES,
  type PaperSettings,
  paperLayout,
} from "../../domain/print/paper";

export interface ExportBlock {
  readonly rect: Rect;
  readonly content:
    | { readonly kind: "html"; readonly html: string }
    | { readonly kind: "image"; readonly src: string; readonly alt: string };
  readonly caption?: {
    readonly text: string;
    readonly position: "above" | "below";
  };
  // A picture's own size (an SVG's, an image file's), when known: where it is drawn in
  // the block, so a page with only the empty edge of a large one can be left out.
  readonly natural?: { readonly width: number; readonly height: number };
  // How a Markdown or Mermaid block shows its content (absent: as written, an image
  // shrunk to fit). A fitted text is sized when the page is laid out (`fitExportPage`).
  readonly display?: {
    readonly scalePercent: number;
    readonly autoFit: boolean;
  };
}

// Marks a text body to be fitted to its block once the page is laid out.
export const FIT_TEXT_ATTRIBUTE = "data-fit-text";
const PERCENT = 100;

export interface ExportSheet {
  readonly name: string;
  readonly blocks: readonly ExportBlock[];
}

// The light theme's colours, read from the tokens when the export is made.
export interface ExportPalette {
  readonly text: string;
  readonly textMuted: string;
  readonly border: string;
  readonly borderStrong: string;
  readonly background: string;
  readonly surface: string;
  readonly accent: string;
  readonly captionBackground: string;
}

export type ExportLayout =
  | { readonly kind: "screen" }
  // One page per sheet, as large as its content.
  | { readonly kind: "fit" }
  // Cut into paper pages, each headed by the sheet's name.
  | ({ readonly kind: "paper" } & PaperSettings);

const SHEET_MARGIN = PRINT_CONFIG.sheetMargin;
const TITLE_HEIGHT = PRINT_CONFIG.sheetTitleHeight;
const HEADING_HEIGHT = PRINT_CONFIG.paperHeadingHeight;

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) => HTML_ESCAPES[character] ?? character,
  );
}

function styleOf(palette: ExportPalette): string {
  return `
:root{--text:${palette.text};--muted:${palette.textMuted};--border:${palette.border};--border-strong:${palette.borderStrong};--background:${palette.background};--surface:${palette.surface};--accent:${palette.accent};--caption:${palette.captionBackground};}
*{box-sizing:border-box;}
html,body{margin:0;background:var(--background);color:var(--text);font-family:"Segoe UI","Hiragino Sans","Noto Sans JP",system-ui,sans-serif;font-size:14px;line-height:1.5;}
.sheet-title{margin:0;padding:12px ${SHEET_MARGIN}px;height:${TITLE_HEIGHT}px;font-size:18px;}
.sheet{position:relative;}
.block{position:absolute;display:flex;flex-direction:column;border:1px solid var(--border);border-radius:6px;background:var(--surface);overflow:hidden;}
.block__body{flex:1 1 auto;min-height:0;overflow:hidden;padding:8px;overflow-wrap:anywhere;}
.block__body--image{padding:0;display:flex;align-items:center;justify-content:center;}
.block__body--image img{max-width:100%;max-height:100%;}
.block__body--fit img{width:100%;height:100%;object-fit:contain;}
.block__body--scaled img{flex:0 0 auto;max-width:none;max-height:none;}
.block__content>:first-child{margin-top:0;}.block__content>:last-child{margin-bottom:0;}
.caption{flex:0 0 auto;padding:4px 8px;background:var(--caption);color:var(--muted);font-size:12px;text-align:center;}
.block__body>:first-child{margin-top:0;}.block__body>:last-child{margin-bottom:0;}
.block__body img{max-width:100%;height:auto;}
.block__body a{color:var(--accent);}
.block__body code{padding:0 4px;border-radius:6px;background:var(--background);font-family:ui-monospace,Consolas,monospace;font-size:0.9em;}
.block__body pre{padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--background);white-space:pre-wrap;}
.block__body pre code{padding:0;background:none;}
.block__body blockquote{margin:0 0 8px;padding-left:12px;border-left:3px solid var(--border);color:var(--muted);}
.block__body table{border-collapse:collapse;margin:0 0 8px;}
.block__body th,.block__body td{padding:4px 8px;border:1px solid var(--border-strong);text-align:left;overflow-wrap:break-word;max-width:30em;}
.block__body .markdown-cell-short{white-space:nowrap;}
.block__body th{background:var(--background);}
.block__body .markdown-align-center{text-align:center;}.block__body .markdown-align-right{text-align:right;}
.block__body .markdown-image-alt{color:var(--muted);font-style:italic;}
.page{position:relative;overflow:hidden;break-after:page;}
.page-heading{display:flex;justify-content:space-between;align-items:center;height:${HEADING_HEIGHT}px;padding:0 ${SHEET_MARGIN}px;border-bottom:1px solid var(--border);color:var(--muted);font-size:12px;}
.page-heading__name{font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.page-body{position:absolute;left:0;top:${HEADING_HEIGHT}px;overflow:hidden;}
.page-view{position:relative;overflow:hidden;}
.page:last-child{break-after:auto;}
@media print{html,body{background:var(--surface);}}
`;
}

function blockHtml(
  block: ExportBlock,
  offsetX: number,
  offsetY: number,
): string {
  const { rect } = block;
  const { display, natural } = block;
  const zoom =
    display === undefined || display.autoFit
      ? null
      : display.scalePercent / PERCENT;
  let body: string;
  if (block.content.kind === "html") {
    const fit = display?.autoFit === true ? ` ${FIT_TEXT_ATTRIBUTE}` : "";
    const style = zoom === null ? "" : ` style="zoom:${zoom}"`;
    body = `<div class="block__body"${fit}><div class="block__content"${style}>${block.content.html}</div></div>`;
  } else {
    const mode =
      display === undefined
        ? ""
        : display.autoFit
          ? " block__body--fit"
          : natural === undefined
            ? ""
            : " block__body--scaled";
    const size =
      zoom === null || natural === undefined || mode === ""
        ? ""
        : ` style="width:${natural.width * zoom}px;height:${natural.height * zoom}px"`;
    body = `<div class="block__body block__body--image${mode}"><img src="${escapeHtml(block.content.src)}" alt="${escapeHtml(block.content.alt)}"${size}></div>`;
  }
  const caption =
    block.caption === undefined
      ? ""
      : `<div class="caption">${escapeHtml(block.caption.text)}</div>`;
  const inner =
    block.caption?.position === "above"
      ? `${caption}${body}`
      : `${body}${caption}`;
  return `<div class="block" style="left:${rect.x - offsetX}px;top:${rect.y - offsetY}px;width:${rect.width}px;height:${rect.height}px">${inner}</div>`;
}

function sheetCanvas(sheet: ExportSheet, bounds: Rect): string {
  const blocks = sheet.blocks
    .map((block) => blockHtml(block, bounds.x, bounds.y))
    .join("");
  return `<div class="sheet" style="width:${bounds.width}px;height:${bounds.height}px">${blocks}</div>`;
}

// What each sheet becomes, and the page rules that go with it.
function sheetsMarkup(
  sheets: readonly ExportSheet[],
  layout: ExportLayout,
): { readonly body: string; readonly pageRules: string } {
  const parts: string[] = [];
  const rules: string[] = [];
  sheets.forEach((sheet, index) => {
    const bounds = contentBounds(
      sheet.blocks.map((block) => block.rect),
      SHEET_MARGIN,
    );
    // An empty sheet has nothing to show or print.
    if (bounds === null) return;
    const title = `<h1 class="sheet-title">${escapeHtml(sheet.name)}</h1>`;
    if (layout.kind === "screen") {
      parts.push(`<section>${title}${sheetCanvas(sheet, bounds)}</section>`);
      return;
    }
    if (layout.kind === "fit") {
      const pageName = `sheet-${index}`;
      rules.push(
        `@page ${pageName}{size:${bounds.width}px ${bounds.height + TITLE_HEIGHT}px;margin:0;}`,
      );
      parts.push(
        `<section class="page" style="page:${pageName};width:${bounds.width}px;height:${bounds.height + TITLE_HEIGHT}px">${title}${sheetCanvas(sheet, bounds)}</section>`,
      );
      return;
    }
    const paper = paperLayout(
      sheet.blocks.map((block) => ({
        ...block.rect,
        figure: block.content.kind === "image",
        // A caption is text across the block: the whole block counts as drawn then.
        ...(block.content.kind === "image" &&
        block.natural !== undefined &&
        block.caption === undefined
          ? { drawn: drawnPictureRect(block.rect, block.natural) }
          : {}),
      })),
      layout,
      SHEET_MARGIN,
      HEADING_HEIGHT,
      PRINT_CONFIG.figureSliverFraction,
    );
    if (paper === null) return;
    const canvas = sheetCanvas(sheet, bounds);
    const name = escapeHtml(sheet.name);
    // Each page shows exactly its part of the sheet (not the start of the next part), and
    // is scaled with zoom, not a transform: a browser cuts printed content into pages by its
    // size before a transform, so a transformed sheet taller than the paper was cut off.
    paper.pages.forEach((page, pageIndex) => {
      // In world units, inside the zoomed page view.
      const left = -(page.x - bounds.x);
      const top = -(page.y - bounds.y);
      const number =
        paper.pages.length > 1
          ? `<span>${pageIndex + 1} / ${paper.pages.length}</span>`
          : "";
      parts.push(
        `<div class="page" style="width:${paper.paper.width}px;height:${paper.paper.height}px"><div class="page-heading"><span class="page-heading__name">${name}</span>${number}</div><div class="page-body" style="width:${paper.area.width}px;height:${paper.area.height}px"><div class="page-view" style="zoom:${paper.scale};width:${page.width}px;height:${page.height}px"><div style="position:absolute;left:${left}px;top:${top}px">${canvas}</div></div></div></div>`,
      );
    });
  });
  if (layout.kind === "paper") {
    const paper = PAPER_SIZES[layout.size];
    rules.push(`@page{size:${paper.name} ${layout.orientation};margin:0;}`);
  }
  return { body: parts.join(""), pageRules: rules.join("") };
}

export function buildExportHtml(input: {
  readonly title: string;
  readonly sheets: readonly ExportSheet[];
  readonly palette: ExportPalette;
  readonly layout: ExportLayout;
}): string {
  const { body, pageRules } = sheetsMarkup(input.sheets, input.layout);
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.title)}</title><style>${styleOf(input.palette)}${pageRules}</style></head><body>${body}</body></html>
`;
}

// The largest page of a "fit" layout (one page per sheet, its title above), or null when no
// sheet has blocks.
export function largestFitPage(
  sheets: readonly ExportSheet[],
): { readonly width: number; readonly height: number } | null {
  const pages = sheets.flatMap((sheet) => {
    const bounds = contentBounds(
      sheet.blocks.map((block) => block.rect),
      SHEET_MARGIN,
    );
    return bounds === null
      ? []
      : [{ width: bounds.width, height: bounds.height + TITLE_HEIGHT }];
  });
  if (pages.length === 0) return null;
  return {
    width: Math.max(...pages.map((page) => page.width)),
    height: Math.max(...pages.map((page) => page.height)),
  };
}
