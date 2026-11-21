import { describe, expect, it } from "vitest";
import {
  buildExportHtml,
  type ExportPalette,
  escapeHtml,
  FIT_TEXT_ATTRIBUTE,
  largestFitPage,
} from "./export-html";

const PALETTE: ExportPalette = {
  text: "#000",
  textMuted: "#666",
  border: "#ddd",
  borderStrong: "#888",
  background: "#fafafa",
  surface: "#fff",
  accent: "#25e",
  captionBackground: "#eee",
};

const SHEETS = [
  {
    name: "Overview <1>",
    blocks: [
      {
        rect: { x: 100, y: 50, width: 200, height: 100 },
        content: { kind: "html" as const, html: "<p>hello</p>" },
      },
      {
        rect: { x: 400, y: 50, width: 120, height: 80 },
        content: {
          kind: "image" as const,
          src: "data:image/png;base64,AA",
          alt: 'a"b',
        },
        caption: { text: "Figure 1", position: "below" as const },
      },
    ],
  },
  { name: "Empty", blocks: [] },
];

describe("buildExportHtml", () => {
  it("places blocks relative to the sheet's content box and escapes names", () => {
    const html = buildExportHtml({
      title: "Doc & co",
      sheets: SHEETS,
      palette: PALETTE,
      layout: { kind: "screen" },
    });
    expect(html).toContain("<title>Doc &amp; co</title>");
    expect(html).toContain("Overview &lt;1&gt;");
    // The margin (24) puts the first block at 24, 24.
    expect(html).toContain("left:24px;top:24px;width:200px;height:100px");
    expect(html).toContain('alt="a&quot;b"');
    expect(html).toContain('<div class="caption">Figure 1</div>');
    expect(html).not.toContain("<script");
    // Set in the app's own fonts, so text breaks where it does on screen.
    expect(html).toContain("font-family:system-ui,-apple-system");
    // An empty sheet is left out.
    expect(html).not.toContain(">Empty<");
  });

  it("shows a block's chosen display size, and marks a text to fit for later", () => {
    const html = buildExportHtml({
      title: "Sizes",
      sheets: [
        {
          name: "S",
          blocks: [
            {
              rect: { x: 0, y: 0, width: 200, height: 100 },
              content: { kind: "html" as const, html: "<p>big</p>" },
              display: { scalePercent: 150, autoFit: false },
            },
            {
              rect: { x: 300, y: 0, width: 200, height: 100 },
              content: { kind: "html" as const, html: "<p>fit</p>" },
              display: { scalePercent: 100, autoFit: true },
            },
            {
              rect: { x: 600, y: 0, width: 200, height: 100 },
              content: { kind: "image" as const, src: "data:,", alt: "" },
              natural: { width: 80, height: 40 },
              display: { scalePercent: 50, autoFit: false },
            },
            {
              rect: { x: 900, y: 0, width: 200, height: 100 },
              content: { kind: "image" as const, src: "data:,", alt: "" },
              natural: { width: 80, height: 40 },
              display: { scalePercent: 100, autoFit: true },
            },
          ],
        },
      ],
      palette: PALETTE,
      layout: { kind: "screen" },
    });
    expect(html).toContain('<div class="block__content" style="zoom:1.5">');
    expect(html).toContain(`<div class="block__body" ${FIT_TEXT_ATTRIBUTE}>`);
    expect(html).toContain('style="width:40px;height:20px"');
    expect(html).toContain("block__body--image block__body--fit");
  });

  it("gives each sheet a page of its own size when fitting", () => {
    const html = buildExportHtml({
      title: "t",
      sheets: SHEETS,
      palette: PALETTE,
      layout: { kind: "fit" },
    });
    expect(html).toMatch(/@page sheet-0\{size:468px \d+px;margin:0;\}/);
  });

  it("cuts a sheet into paper pages", () => {
    const html = buildExportHtml({
      title: "t",
      sheets: SHEETS,
      palette: PALETTE,
      layout: {
        kind: "paper",
        size: "a4",
        orientation: "landscape",
        scale: "actual",
      },
    });
    expect(html).toContain("@page{size:A4 landscape;margin:0;}");
    expect(html).toContain('class="page" style="width:1123px;height:794px"');
    // Every page is headed by the sheet's name; the content goes below the heading.
    expect(html).toContain(
      '<div class="page-heading"><span class="page-heading__name">Overview &lt;1&gt;</span></div>',
    );
    expect(html).toContain(
      'class="page-body" style="width:1123px;height:762px"',
    );
    // Scaled by zoom (printing cuts pages before a transform), clipped to the page's part.
    expect(html).not.toContain("transform:scale");
    expect(html).toMatch(
      /class="page-view" style="zoom:1;width:\d+px;height:\d+px"/,
    );
  });

  it("numbers the pages of a sheet cut into several", () => {
    const html = buildExportHtml({
      title: "t",
      sheets: [
        {
          name: "Long",
          blocks: [0, 1, 2].map((row) => ({
            rect: { x: 0, y: row * 700, width: 300, height: 600 },
            content: { kind: "html" as const, html: "<p>x</p>" },
          })),
        },
      ],
      palette: PALETTE,
      layout: {
        kind: "paper",
        size: "a4",
        orientation: "portrait",
        scale: "actual",
      },
    });
    expect(html).toContain("<span>1 / 3</span>");
    expect(html).toContain("<span>3 / 3</span>");
  });
});

describe("largestFitPage", () => {
  it("is the widest and the tallest sheet page, title included", () => {
    expect(largestFitPage(SHEETS)).toEqual({ width: 468, height: 148 + 48 });
    expect(largestFitPage([{ name: "Empty", blocks: [] }])).toBeNull();
  });
});

describe("escapeHtml", () => {
  it("escapes the five special characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});
