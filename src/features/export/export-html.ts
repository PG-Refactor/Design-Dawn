// One self-contained HTML page of sheets: every block at its place, Markdown as the
// sanitised HTML the app shows, diagrams and images as data URLs. No script, no external
// file. The same page is used for the HTML export and, with page rules, for printing.

import {
  contentBounds,
  paginate,
  type Rect,
} from "../../domain/print/page-layout";

export interface ExportBlock {
  readonly rect: Rect;
  readonly content:
    | { readonly kind: "html"; readonly html: string }
    | { readonly kind: "image"; readonly src: string; readonly alt: string };
  readonly caption?: {
    readonly text: string;
    readonly position: "above" | "below";
  };
}

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

export const PAPER_SIZES = {
  // At the CSS reference of 96 pixels per inch.
  a4: { width: 794, height: 1123, name: "A4" },
  a3: { width: 1123, height: 1587, name: "A3" },
} as const;
export type PaperSize = keyof typeof PAPER_SIZES;
export type Orientation = "portrait" | "landscape";
export type PaperScale = "actual" | "fitWidth" | "fitPage";

export type ExportLayout =
  | { readonly kind: "screen" }
  // One page per sheet, as large as its content.
  | { readonly kind: "fit" }
  | {
      readonly kind: "paper";
      readonly size: PaperSize;
      readonly orientation: Orientation;
      readonly scale: PaperScale;
    };

// Space around the blocks of a sheet, and the height of a sheet's title line.
const SHEET_MARGIN = 24;
const TITLE_HEIGHT = 48;

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
.caption{flex:0 0 auto;padding:4px 8px;background:var(--caption);color:var(--muted);font-size:12px;text-align:center;}
.block__body>:first-child{margin-top:0;}.block__body>:last-child{margin-bottom:0;}
.block__body img{max-width:100%;height:auto;}
.block__body a{color:var(--accent);}
.block__body code{padding:0 4px;border-radius:6px;background:var(--background);font-family:ui-monospace,Consolas,monospace;font-size:0.9em;}
.block__body pre{padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--background);white-space:pre-wrap;}
.block__body pre code{padding:0;background:none;}
.block__body blockquote{margin:0 0 8px;padding-left:12px;border-left:3px solid var(--border);color:var(--muted);}
.block__body table{border-collapse:collapse;margin:0 0 8px;}
.block__body th,.block__body td{padding:4px 8px;border:1px solid var(--border-strong);text-align:left;}
.block__body th{background:var(--background);}
.block__body .markdown-align-center{text-align:center;}.block__body .markdown-align-right{text-align:right;}
.block__body .markdown-image-alt{color:var(--muted);font-style:italic;}
.page{position:relative;overflow:hidden;break-after:page;}
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
  const body =
    block.content.kind === "html"
      ? `<div class="block__body">${block.content.html}</div>`
      : `<div class="block__body block__body--image"><img src="${escapeHtml(block.content.src)}" alt="${escapeHtml(block.content.alt)}"></div>`;
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

function paperDimensions(
  size: PaperSize,
  orientation: Orientation,
): { readonly width: number; readonly height: number } {
  const paper = PAPER_SIZES[size];
  return orientation === "portrait"
    ? { width: paper.width, height: paper.height }
    : { width: paper.height, height: paper.width };
}

function paperScale(
  scale: PaperScale,
  bounds: Rect,
  page: { width: number; height: number },
): number {
  switch (scale) {
    case "actual":
      return 1;
    case "fitWidth":
      return Math.min(1, page.width / bounds.width);
    case "fitPage":
      return Math.min(
        1,
        page.width / bounds.width,
        page.height / bounds.height,
      );
  }
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
    const paper = paperDimensions(layout.size, layout.orientation);
    const scale = paperScale(layout.scale, bounds, paper);
    const pages = paginate(
      bounds,
      sheet.blocks.map((block) => block.rect),
      paper.width / scale,
      paper.height / scale,
    );
    const canvas = sheetCanvas(sheet, bounds);
    for (const page of pages) {
      const left = -(page.x - bounds.x) * scale;
      const top = -(page.y - bounds.y) * scale;
      parts.push(
        `<div class="page" style="width:${paper.width}px;height:${paper.height}px"><div style="position:absolute;left:${left}px;top:${top}px;transform:scale(${scale});transform-origin:0 0">${canvas}</div></div>`,
      );
    }
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
