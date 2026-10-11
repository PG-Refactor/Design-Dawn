// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "./sanitize-svg";

const SVG_START =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">';

function clean(inner: string, rootAttributes = ""): string {
  return sanitizeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" ${rootAttributes}>${inner}</svg>`,
  );
}

function parse(svg: string): Document {
  return new DOMParser().parseFromString(svg, "image/svg+xml");
}

describe("sanitizeSvg removes what can run or load", () => {
  it("drops script elements and their content", () => {
    const result = clean("<script>alert(1)</script><text>kept</text>");
    expect(result).not.toContain("script");
    expect(result).not.toContain("alert");
    expect(result).toContain("kept");
  });

  it("drops foreignObject, iframe, object, embed and image", () => {
    const result = clean(
      '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">html</div></foreignObject>' +
        '<iframe src="https://example.invalid"></iframe><object data="x"></object>' +
        '<embed src="x"/><image href="https://example.invalid/a.png"/>',
    );
    for (const name of [
      "foreignObject",
      "iframe",
      "object",
      "embed",
      "image",
    ]) {
      expect(result.toLowerCase()).not.toContain(name.toLowerCase());
    }
    expect(result).not.toContain("example.invalid");
  });

  it("drops event handler attributes", () => {
    const result = clean(
      '<rect width="5" height="5" onclick="alert(1)" onmouseover="alert(2)"/>',
      'onload="alert(3)"',
    );
    expect(result).not.toMatch(/\bon[a-z]+=/);
    expect(result).toContain("<rect");
  });

  it("drops href and xlink:href unless they point inside the image", () => {
    const xlink = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
    const result = clean(
      `<linearGradient id="inside" href="#base"/>` +
        `<linearGradient id="outside" href="https://example.invalid/x.svg#a"/>` +
        `<linearGradient id="data" href="data:image/svg+xml;base64,AAAA"/>` +
        `<linearGradient id="script" ${xlink} xlink:href="javascript:alert(1)"/>` +
        `<linearGradient id="spaced" href="  http://example.invalid/"/>` +
        `<linearGradient id="inside-xlink" ${xlink} xlink:href="#base"/>`,
    );
    expect(result).not.toContain("example.invalid");
    expect(result).not.toContain("javascript");
    expect(result).not.toContain("data:");
    const document = parse(result);
    const gradient = (id: string) => document.getElementById(id);
    expect(gradient("inside")?.getAttribute("href")).toBe("#base");
    expect(
      gradient("inside-xlink")?.getAttributeNS(
        "http://www.w3.org/1999/xlink",
        "href",
      ),
    ).toBe("#base");
    for (const id of ["outside", "data", "script", "spaced"]) {
      expect(gradient(id), id).not.toBeNull();
      const names = [...(gradient(id)?.attributes ?? [])].map(
        (attribute) => attribute.name,
      );
      expect(
        names.filter((name) => name.endsWith("href")),
        id,
      ).toEqual([]);
    }
  });

  it("does not keep <use>: it is outside the SVG profile, so no external reference can be built with it", () => {
    const result = clean(
      '<defs><path id="shape" d="M0 0"/></defs><use href="#shape"/><use href="https://example.invalid/x.svg#a"/>',
    );
    expect(parse(result).querySelectorAll("use")).toHaveLength(0);
    expect(result).not.toContain("example.invalid");
  });

  it("drops links but keeps their text", () => {
    const result = clean(
      '<a href="https://example.invalid"><text>label</text></a>',
    );
    expect(result).not.toContain("<a");
    expect(result).not.toContain("example.invalid");
    expect(result).toContain("label");
  });

  it("neutralises external url() in style attributes, presentation attributes and <style>", () => {
    const result = clean(
      '<rect style="fill:url(https://example.invalid/a#b);stroke:url(#grad)" fill="url(http://example.invalid/c)" filter="url(#blur)"/>' +
        "<style>.a{background:url('https://example.invalid/d.png')}.b{fill:url(#grad)}" +
        "@import url(https://example.invalid/e.css);.c{background:image-set('x.png' 1x)}</style>",
    );
    expect(result).not.toContain("example.invalid");
    expect(result).not.toContain("@import");
    expect(result).not.toContain("image-set");
    expect(result).toContain("url(#grad)");
    expect(result).toContain("url(#blur)");
  });

  it("defeats a url() written with CSS escapes", () => {
    const result = clean(
      '<rect style="fill:u\\72l(https://example.invalid/x)"/>',
    );
    expect(result).not.toMatch(/\\72/);
    expect(result).not.toMatch(/url\(https/i);
  });
});

function styleAttributeOf(svg: string): string | null {
  return parse(svg).querySelector("rect")?.getAttribute("style") ?? null;
}

function rectWithStyle(style: string): string {
  const escaped = style.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return clean(`<rect style="${escaped}"/>`);
}

describe("sanitizeSvg filters CSS references (review findings)", () => {
  it.each([
    'fill:url("http://example.invalid/a)b")',
    "fill:url('http://example.invalid/a\"b')",
    'background-image:image("http://example.invalid/x")',
    "fill:url(http://example.invalid/x)",
    "fill:u\\72l(http://example.invalid)",
    "fill:\\75\\72\\6c(http://example.invalid)",
  ])("removes the declaration %s from a style attribute", (declaration) => {
    const result = rectWithStyle(`stroke:#333;${declaration};opacity:.5`);
    expect(result).not.toContain("example.invalid");
    expect(styleAttributeOf(result)).toBe("stroke:#333;opacity:.5");
  });

  it("removes a style attribute that cannot be parsed", () => {
    const result = rectWithStyle('fill:url("http://example.invalid');
    expect(result).not.toContain("example.invalid");
    expect(styleAttributeOf(result)).toBeNull();
  });

  it("filters <style> rules and drops @import / @font-face", () => {
    const result = clean(
      "<style>@import url(http://example.invalid/e.css);@font-face{src:url(http://example.invalid/f)}" +
        '.node rect{fill:url("http://example.invalid/a)b");stroke:#333}' +
        "@keyframes k{from{opacity:0}to{opacity:1}}.ok{fill:url(#grad)}</style>",
    );
    expect(result).not.toContain("example.invalid");
    expect(parse(result).querySelector("style")?.textContent).toBe(
      ".node rect{stroke:#333}@keyframes k{from{opacity:0}to{opacity:1}}.ok{fill:url(#grad)}",
    );
  });

  it("empties a <style> it cannot parse", () => {
    const result = clean('<style>.a{fill:url("http://example.invalid}</style>');
    expect(result).not.toContain("example.invalid");
    expect(parse(result).querySelector("style")?.textContent).toBe("");
  });

  it("removes a presentation attribute with an external reference and keeps internal ones", () => {
    const result = clean(
      '<rect id="bad" fill="url(&quot;http://example.invalid/a)b&quot;)" stroke="url(http://example.invalid/c)" filter="image(red)" cursor="url(http://example.invalid/d), auto" marker-end="url(#arrow)"/>' +
        '<rect id="good" fill="url( &quot;#grad&quot; )" stroke="#333" clip-path="url(#clip)"/>',
    );
    expect(result).not.toContain("example.invalid");
    const document = parse(result);
    const bad = document.getElementById("bad");
    for (const name of ["fill", "stroke", "filter", "cursor"]) {
      expect(bad?.hasAttribute(name), name).toBe(false);
    }
    expect(bad?.getAttribute("marker-end")).toBe("url(#arrow)");
    const good = document.getElementById("good");
    expect(good?.getAttribute("fill")).toBe('url( "#grad" )');
    expect(good?.getAttribute("stroke")).toBe("#333");
    expect(good?.getAttribute("clip-path")).toBe("url(#clip)");
  });

  it("removes an external url in a themeCSS-style rule", () => {
    const result = clean(
      '<style>#d .node rect{fill:url("http://example.invalid/a)b")}#d .edge{stroke:red}</style>',
    );
    expect(result).not.toContain("example.invalid");
    expect(parse(result).querySelector("style")?.textContent).toBe(
      "#d .node rect{}#d .edge{stroke:red}",
    );
  });
});

describe("sanitizeSvg leaves ordinary attributes and text alone", () => {
  it("keeps backslashes, url( text and quotes in aria-label, id, class and text", () => {
    const label = "a\\b url(http://x) \"quoted\" 'single' (paren)";
    const result = clean(
      `<g id="id\\1" class="c url(x)" aria-label="${label.replace(/"/g, "&quot;")}"><text>${label.replace(/&/g, "&amp;")}</text></g>`,
    );
    const group = parse(result).querySelector("g");
    expect(group?.getAttribute("aria-label")).toBe(label);
    expect(group?.getAttribute("id")).toBe("id\\1");
    expect(group?.getAttribute("class")).toBe("c url(x)");
    expect(group?.querySelector("text")?.textContent).toBe(label);
  });

  it("keeps d and transform values byte-identical", () => {
    const result = clean(
      '<path d="M0 0L10 10z" transform="translate(1,2) rotate(3)"/>',
    );
    const path = parse(result).querySelector("path");
    expect(path?.getAttribute("d")).toBe("M0 0L10 10z");
    expect(path?.getAttribute("transform")).toBe("translate(1,2) rotate(3)");
  });

  it("still removes event handlers and external hrefs next to them", () => {
    const result = clean(
      '<rect onclick="alert(1)" fill="url(http://example.invalid/x)" style="fill:red"/><linearGradient href="http://example.invalid/y"/>',
    );
    expect(result).not.toMatch(/\bon[a-z]+=/);
    expect(result).not.toContain("example.invalid");
    expect(styleAttributeOf(result)).toBe("fill:red");
  });
});

describe("sanitizeSvg keeps what a diagram needs", () => {
  it("keeps paths, text, groups, markers, style and internal references", () => {
    const result = clean(
      "<style>.edge{stroke:#333}</style>" +
        '<defs><marker id="arrow" markerWidth="4" markerHeight="4"><path d="M0 0L4 2L0 4z"/></marker>' +
        '<linearGradient id="grad"><stop offset="0"/></linearGradient></defs>' +
        '<g class="edge"><path d="M0 0L10 10" marker-end="url(#arrow)" fill="url(#grad)"/>' +
        '<text x="1" y="2"><tspan>ラベル</tspan></text></g>',
    );
    const document = parse(result);
    expect(document.querySelector("parsererror")).toBeNull();
    expect(document.querySelector("style")?.textContent).toContain(".edge");
    expect(document.querySelector("marker#arrow path")).not.toBeNull();
    const edge = document.querySelector("g.edge > path");
    expect(edge?.getAttribute("marker-end")).toBe("url(#arrow)");
    expect(edge?.getAttribute("fill")).toBe("url(#grad)");
    expect(document.querySelector("tspan")?.textContent).toBe("ラベル");
    expect(document.querySelector("g")?.getAttribute("class")).toBe("edge");
  });

  it("keeps the child combinator and quotes of a stylesheet", () => {
    const result = clean('<style>g > path[data-x="1"]{fill:none}</style>');
    expect(parse(result).querySelector("style")?.textContent).toBe(
      'g > path[data-x="1"]{fill:none}',
    );
  });
});

describe("sanitizeSvg output", () => {
  it("is well-formed XML with the SVG namespace, even for HTML-only entities", () => {
    const result = sanitizeSvg(
      `${SVG_START}<text>a&nbsp;b &amp; c</text></svg>`,
    );
    const document = parse(result);
    expect(document.querySelector("parsererror")).toBeNull();
    expect(document.documentElement.namespaceURI).toBe(
      "http://www.w3.org/2000/svg",
    );
    expect(document.querySelector("text")?.textContent).toBe("a b & c");
  });

  it("gives the root the size of its viewBox instead of a relative width", () => {
    const result = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="-8 -8 320 180" style="max-width: 320px;"></svg>',
    );
    const root = parse(result).documentElement;
    expect(root.getAttribute("width")).toBe("320");
    expect(root.getAttribute("height")).toBe("180");
  });

  it("leaves the size alone when there is no usable viewBox", () => {
    const result = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 0 0"></svg>',
    );
    expect(parse(result).documentElement.getAttribute("width")).toBe("100%");
  });

  it("refuses input that is not a single SVG image", () => {
    expect(() => sanitizeSvg("<p>text</p>")).toThrow();
    expect(() => sanitizeSvg("")).toThrow();
    expect(() =>
      sanitizeSvg(
        `${SVG_START}</svg><svg xmlns="http://www.w3.org/2000/svg"></svg>`,
      ),
    ).toThrow();
  });

  it("does not share hooks with the Markdown sanitiser", async () => {
    const { sanitizeHtml } = await import("../markdown/sanitize-html");
    // The Markdown link would lose its href if the SVG hook leaked into it.
    clean("<text>first</text>");
    expect(sanitizeHtml('<a href="https://example.com/">a</a>')).toContain(
      'href="https://example.com/"',
    );
    expect(clean("<text>again</text>")).toContain("again");
  });
});
