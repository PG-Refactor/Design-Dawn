import { describe, expect, it } from "vitest";
import {
  filterDeclarationList,
  filterStylesheet,
  isReferenceSafeValue,
} from "./css-reference-filter";

// Each of these must be removed from a declaration list.
const REJECTED_DECLARATIONS = [
  // The review findings.
  'fill:url("http://e/a)b")',
  "fill:url('http://e/a\"b')",
  'background-image:image("http://e/x")',
  "fill:url(http://e/x)",
  // CSS escapes spelling the function name.
  "fill:u\\72l(http://e)",
  "fill:\\75\\72\\6c(http://e)",
  "fill:\\75 rl(http://e)",
  "fill:URL(http://e)",
  "fill:UrL(http://e)",
  // Escaped quote and escaped ")" inside a string.
  'fill:url("http://e/a\\"b)")',
  'fill:url("http://e/a\\)b")',
  // Whitespace and newlines.
  'fill:url(  "http://e" )',
  'fill:url(\n"http://e"\n)',
  "fill:url(\n http://e \n)",
  // A comment is not a comment inside an unquoted url token.
  "fill:url(/**/http://e)",
  "fill:url(/*#x*/)",
  // Escapes inside the target: the decoded value is what counts.
  'fill:url("\\68ttp://e")',
  "fill:url(\\68ttp://e)",
  // Other fetching functions.
  "background:image-set('x.png' 1x)",
  "background:-webkit-image-set(url(#a) 1x)",
  "background:cross-fade(url(#a), url(#b))",
  "background:-webkit-cross-fade(red, blue)",
  "background:element(#a)",
  "background:-moz-element(#a)",
  'content:src("x")',
  "background:IMAGE(red)",
  "background:i\\6d age(red)",
  // Strict fragment shape.
  "fill:url(#)",
  'fill:url("#a b")',
  'fill:url("#a\\29")',
  "fill:url(#a/b)",
  "fill:url()",
  'fill:url("")',
  'fill:url("#a", "#b")',
  // Nested inside another function.
  "background:foo(url(http://e))",
  // The whole declaration goes, not only the token.
  "background:red url(http://e) no-repeat",
];

describe("filterDeclarationList removes", () => {
  it.each(REJECTED_DECLARATIONS)("%s", (declaration) => {
    expect(filterDeclarationList(declaration)).toBe("");
    expect(filterDeclarationList(`${declaration};`)).toBe("");
  });

  it("only the bad declaration; the others stay byte-identical", () => {
    const input =
      "stroke:#333 ;  fill:url(http://e/x);\n  opacity: .5;stroke-width:2px";
    expect(filterDeclarationList(input)).toBe(
      "stroke:#333 ;\n  opacity: .5;stroke-width:2px",
    );
  });

  it("the whole declaration when the bad token is nested in a function", () => {
    expect(filterDeclarationList("a:b;c:calc(1px + url(http://e));d:e")).toBe(
      "a:b;d:e",
    );
  });
});

describe("filterDeclarationList keeps", () => {
  it.each([
    "fill:url(#arrow)",
    "fill:url('#x')",
    'fill:url( "#x" )',
    "fill:url(  #x  )",
    'fill:url("#dawn-mermaid-1_flowchart-v2-pointEnd")',
    "marker-end:url(#a:b.c-d_e)",
    "filter:url(#blur) drop-shadow(1px 1px 2px red)",
    "fill:URL(#x)",
    "fill:u\\72l(#x)",
    'font-family:"trebuchet ms", verdana;color:#333;stroke-width:1.5px',
    "content:'url(http://not-a-function)'",
    "/* url(http://e) */fill:red",
    // `url (` with a space is not a function in CSS; it is a keyword and a group.
    "fill:url (http://e)",
    "--x:calc(1px + 2px);fill:red",
    "fill:1url(red)",
    "",
  ])("%s", (declaration) => {
    expect(filterDeclarationList(declaration)).toBe(declaration);
  });
});

describe("filterDeclarationList on malformed input", () => {
  it.each([
    'fill:url("http://e',
    "fill:url(http://e",
    "fill:url(http://e x)",
    "fill:url(a'b)",
    "fill:url(a(b)",
    "fill:red /* never closed",
    'fill:"line\nbreak"',
    "fill:calc(1px",
    "fill:red)",
    "fill:red]",
    "a:{b",
    "fill:url('http://e\\",
  ])("rejects %j as a whole without throwing", (input) => {
    expect(filterDeclarationList(input)).toBeNull();
    expect(isReferenceSafeValue(input)).toBe(false);
  });

  it("never throws, whatever the input", () => {
    for (const input of [
      "\\",
      '"',
      "'",
      "/*",
      "url(",
      "u\\",
      "@",
      "(((",
      "}}}",
      "\u0000",
      "\\\n",
    ]) {
      expect(() => filterDeclarationList(input)).not.toThrow();
      expect(() => filterStylesheet(input)).not.toThrow();
      expect(() => isReferenceSafeValue(input)).not.toThrow();
    }
  });
});

describe("filterStylesheet", () => {
  it("removes the bad declaration of a rule, keeps the rest and the selector", () => {
    expect(
      filterStylesheet('.node rect{fill:url("http://e/a)b");stroke:#333}'),
    ).toBe(".node rect{stroke:#333}");
    expect(filterStylesheet('.node rect{fill:url("http://e/a)b")}')).toBe(
      ".node rect{}",
    );
  });

  it("drops @import, @namespace and @font-face entirely", () => {
    expect(
      filterStylesheet(
        '@import url(x);@import "y.css";@namespace svg url(http://www.w3.org/2000/svg);@font-face{font-family:f;src:url(x)}.a{fill:red}',
      ),
    ).toBe(".a{fill:red}");
    expect(filterStylesheet("@IMPORT url(x);.a{fill:red}")).toBe(
      ".a{fill:red}",
    );
    expect(filterStylesheet("@\\69mport url(x);.a{fill:red}")).toBe(
      ".a{fill:red}",
    );
    expect(filterStylesheet("@font-face{src:url(#a)}")).toBe("");
  });

  it("processes @keyframes, @media and @supports recursively", () => {
    const keyframes =
      "@keyframes spin{from{transform:rotate(0)}to{transform:rotate(1turn)}}";
    expect(filterStylesheet(keyframes)).toBe(keyframes);
    expect(
      filterStylesheet(
        "@media (min-width: 1px){.a{fill:url(http://e);stroke:red}@font-face{src:url(x)}}",
      ),
    ).toBe("@media (min-width: 1px){.a{stroke:red}}");
    expect(
      filterStylesheet("@keyframes k{0%{fill:url(http://e)}100%{fill:red}}"),
    ).toBe("@keyframes k{0%{}100%{fill:red}}");
  });

  it("drops a rule whose selector holds a rejected token", () => {
    expect(
      filterStylesheet("a[x=y]:not(image(red)){fill:red}.b{fill:blue}"),
    ).toBe(".b{fill:blue}");
  });

  it("keeps ordinary Mermaid-style CSS byte-identical", () => {
    const css =
      '#my-svg{font-family:"trebuchet ms",verdana,arial,sans-serif;font-size:16px;fill:#333;}\n' +
      "@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}\n" +
      "#my-svg .edge-animation-slow{stroke-dasharray:9,5!important;animation:dash 50s linear infinite;}\n" +
      '#my-svg g > path[data-x="1"]:hover::after,.a+.b~.c{fill:url(#grad);marker-end:url("#m")}\n' +
      '#my-svg :root{--mermaid-font-family:"trebuchet ms"}\n/* trailing */';
    expect(filterStylesheet(css)).toBe(css);
  });

  it("removes a themeCSS-style rule with an external url", () => {
    const css = '.a{fill:red}.node rect{fill:url("http://e/a)b")}.b{fill:blue}';
    expect(filterStylesheet(css)).toBe(".a{fill:red}.node rect{}.b{fill:blue}");
  });

  it("returns null for malformed CSS", () => {
    expect(filterStylesheet('.a{fill:url("x}')).toBeNull();
    expect(filterStylesheet(".a{fill:red")).toBeNull();
    expect(filterStylesheet(".a{fill:url(x}")).toBeNull();
    expect(filterStylesheet("/* open")).toBeNull();
  });

  it("returns an empty string for an empty stylesheet", () => {
    expect(filterStylesheet("")).toBe("");
  });
});

describe("isReferenceSafeValue", () => {
  it("accepts colours, keywords and internal references", () => {
    for (const value of [
      "none",
      "#333",
      "rgb(1, 2, 3)",
      "url(#grad)",
      "url(#grad) red",
      'url("#grad")',
      "",
    ]) {
      expect(isReferenceSafeValue(value), value).toBe(true);
    }
  });

  it("rejects external references", () => {
    for (const value of [
      "url(http://e)",
      "url(//e/x)",
      "url(data:image/svg+xml;base64,AAAA)",
      "url(javascript:alert(1))",
      'url("https://e/a)b")',
      "image(red)",
      "url(#a) url(http://e)",
    ]) {
      expect(isReferenceSafeValue(value), value).toBe(false);
    }
  });
});
