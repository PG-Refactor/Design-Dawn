import { describe, expect, it } from "vitest";
import { buildExportHtml, type ExportPalette, escapeHtml } from "./export-html";

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
    // An empty sheet is left out.
    expect(html).not.toContain(">Empty<");
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
  });
});

describe("escapeHtml", () => {
  it("escapes the five special characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});
