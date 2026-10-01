// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown, renderMarkdownToHtml } from "./render-markdown";
import { sanitizeHtml } from "./sanitize-html";
import { parseHtml, unsafeFindings } from "./test-support/dom-assertions";

function render(source: string): Document {
  return parseHtml(renderMarkdown(source));
}

const textOf = (document: Document) => document.body.textContent ?? "";

describe("rendering", () => {
  it("renders headings, paragraphs, emphasis and strong text", () => {
    const document = render(
      "# Title\n\n## Sub\n\nA *soft* and **hard** ~~old~~ text",
    );
    expect(document.querySelector("h1")?.textContent).toBe("Title");
    expect(document.querySelector("h2")?.textContent).toBe("Sub");
    expect(document.querySelector("p em")?.textContent).toBe("soft");
    expect(document.querySelector("p strong")?.textContent).toBe("hard");
    expect(document.querySelector("p s")?.textContent).toBe("old");
  });

  it("renders unordered and ordered lists (an ordered list keeps its start)", () => {
    const document = render("- a\n- b\n\n3. c\n4. d");
    expect(
      [...document.querySelectorAll("ul > li")].map((li) => li.textContent),
    ).toEqual(["a", "b"]);
    const ordered = document.querySelector("ol");
    expect(ordered?.getAttribute("start")).toBe("3");
    expect(ordered?.querySelectorAll("li")).toHaveLength(2);
    expect(unsafeFindings(document)).toEqual([]);
  });

  it("renders inline code, fenced code (with its language class) and blockquotes", () => {
    const document = render(
      "Use `npm test`\n\n```ts\nconst a = 1;\n```\n\n> quoted",
    );
    expect(document.querySelector("p code")?.textContent).toBe("npm test");
    const fenced = document.querySelector("pre > code");
    expect(fenced?.textContent).toBe("const a = 1;\n");
    expect(fenced?.className).toBe("language-ts");
    expect(document.querySelector("blockquote")?.textContent?.trim()).toBe(
      "quoted",
    );
  });

  it("renders http, https and mailto links", () => {
    const document = render(
      "[a](http://example.com) [b](https://example.com/x?y=1) [c](mailto:me@example.com)",
    );
    expect(
      [...document.querySelectorAll("a")].map((a) => a.getAttribute("href")),
    ).toEqual([
      "http://example.com",
      "https://example.com/x?y=1",
      "mailto:me@example.com",
    ]);
    expect(unsafeFindings(document)).toEqual([]);
  });

  it("renders tables (alignment is dropped, not turned into style)", () => {
    const document = render("| a | b |\n|:--|--:|\n| 1 | 2 |");
    expect(document.querySelectorAll("table thead th")).toHaveLength(2);
    expect(document.querySelectorAll("table tbody td")).toHaveLength(2);
    expect(document.querySelector("th")?.hasAttribute("style")).toBe(false);
    expect(unsafeFindings(document)).toEqual([]);
  });

  it("keeps Japanese text", () => {
    const document = render("# 日本語の見出し\n\nこれは**本文**です。");
    expect(document.querySelector("h1")?.textContent).toBe("日本語の見出し");
    expect(document.querySelector("strong")?.textContent).toBe("本文");
  });

  it("renders an empty source as nothing", () => {
    expect(renderMarkdown("")).toBe("");
  });
});

describe("links and images are never loaded or followed", () => {
  const unsafeLinks = [
    "[link](javascript:alert(1))",
    "[x](JaVaScRiPt:alert(1))",
    "[x](data:text/html,<script>alert(1)</script>)",
    "[x](vbscript:msgbox(1))",
    "[x](file:///etc/passwd)",
    "[x](java&#x09;script:alert(1))",
    "[x](&#106;avascript:alert(1))",
    "<javascript:alert(1)>",
  ];

  it.each(unsafeLinks)("does not make a link of %s", (source) => {
    const document = render(source);
    expect(document.querySelector("a")).toBeNull();
    expect(unsafeFindings(document)).toEqual([]);
  });

  it("treats relative links and fragments as plain text", () => {
    const document = render(
      "[a](docs/readme.md) [b](#top) [c](//evil.example/x)",
    );
    expect(document.querySelector("a")).toBeNull();
    expect(textOf(document)).toContain("[a](docs/readme.md)");
  });

  it("does not linkify bare URLs", () => {
    expect(render("see https://example.com").querySelector("a")).toBeNull();
  });

  it("shows the alt text instead of an image, for remote and local sources", () => {
    const remote = render("![alt text](https://example.com/a.png)");
    expect(remote.querySelector("img")).toBeNull();
    expect(remote.querySelector("span.markdown-image-alt")?.textContent).toBe(
      "alt text",
    );

    const unsafe = render("![a](javascript:alert(1))");
    expect(unsafe.querySelector("img")).toBeNull();
    expect(textOf(unsafe)).toContain("a");

    expect(render("![local](./images/a.png)").querySelector("img")).toBeNull();
  });

  it("escapes markup inside alt text", () => {
    const document = render("![<b>x</b>](https://example.com/a.png)");
    expect(document.querySelector("b")).toBeNull();
    expect(document.querySelector("span.markdown-image-alt")?.textContent).toBe(
      "<b>x</b>",
    );
  });
});

describe("raw HTML in the source", () => {
  it("shows a script tag as text", () => {
    const document = render("<script>alert(1)</script>");
    expect(document.querySelector("script")).toBeNull();
    expect(textOf(document)).toContain("<script>alert(1)</script>");
  });

  it("does not produce an img or an onerror attribute", () => {
    const document = render("<img src=x onerror=alert(1)>");
    expect(document.querySelector("img")).toBeNull();
    expect(unsafeFindings(document)).toEqual([]);
    expect(renderMarkdown("<img src=x onerror=alert(1)>")).not.toMatch(/<img/i);
  });

  it.each([
    '<iframe src="https://example.com"></iframe>',
    "<svg onload=alert(1)></svg>",
    '<a href="javascript:alert(1)" onclick="alert(2)">x</a>',
    "<style>body{display:none}</style>",
    '<p style="color:red" onmouseover="alert(1)">x</p>',
    '<form action="https://example.com"><input name=a></form>',
    '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
    '<object data="x"></object><embed src="x">',
    '<base href="https://evil.example/"><meta http-equiv="refresh" content="0"><link rel="stylesheet" href="x">',
  ])("leaves no element or attribute of %s", (source) => {
    const document = render(source);
    expect(unsafeFindings(document)).toEqual([]);
  });

  it("does not decode entities into markup", () => {
    const document = render(
      "&lt;script&gt;alert(1)&lt;/script&gt; and &#60;img src=x&#62;",
    );
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    expect(textOf(document)).toContain("<script>alert(1)</script>");
    expect(unsafeFindings(document)).toEqual([]);
  });
});

describe("the sanitizer on its own (without markdown-it in front)", () => {
  const malicious = [
    "<script>alert(1)</script><p>kept</p>",
    "<img src=x onerror=alert(1)>",
    '<a href="javascript:alert(1)" onclick="alert(2)" style="color:red" target="_blank">x</a>',
    '<a href="  JaVa\tScRiPt:alert(1)">x</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
    '<a href="vbscript:msgbox(1)">x</a>',
    '<svg><script>alert(1)</script><a xlink:href="javascript:alert(1)">x</a></svg>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    "<style>*{background:url(javascript:alert(1))}</style>",
    '<p onmouseover="alert(1)" style="position:fixed" data-x="1" id="x" aria-label="y">t</p>',
    '<math><maction actiontype="statusline#" xlink:href="javascript:alert(1)">x</maction></math>',
    "<form><input autofocus onfocus=alert(1)></form>",
    "<div><b>nested <img src=x onerror=alert(1)></b></div>",
    '<code class="evil other">c</code><span class="markdown-image-alt">ok</span>',
  ];

  it.each(malicious)("strips everything unsafe from %s", (html) => {
    const document = parseHtml(sanitizeHtml(html));
    expect(unsafeFindings(document)).toEqual([]);
  });

  it("keeps the harmless part and only the generated class values", () => {
    const document = parseHtml(sanitizeHtml(malicious[0] ?? ""));
    expect(document.querySelector("p")?.textContent).toBe("kept");
    const classes = parseHtml(sanitizeHtml(malicious.at(-1) ?? ""));
    expect(classes.querySelector("code")?.hasAttribute("class")).toBe(false);
    expect(classes.querySelector("span")?.className).toBe("markdown-image-alt");
  });

  it("keeps allowed links and drops title / target / rel", () => {
    const document = parseHtml(
      sanitizeHtml(
        '<a href="https://example.com" title="t" target="_blank" rel="x">x</a>',
      ),
    );
    const anchor = document.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("https://example.com");
    expect(
      [...(anchor?.attributes ?? [])].map((attribute) => attribute.name),
    ).toEqual(["href"]);
  });

  it("holds for the output of markdown-it fed with hostile input", () => {
    const hostile = [
      "<script>1</script>",
      "[x](javascript:alert(1))",
      "![x](data:image/svg+xml;base64,AAAA)",
      '<a href="javascript:alert(1)">x</a>',
    ].join("\n\n");
    // Stage one's raw output is a string; the sanitizer result is what is displayed.
    expect(typeof renderMarkdownToHtml(hostile)).toBe("string");
    expect(unsafeFindings(render(hostile))).toEqual([]);
  });
});
