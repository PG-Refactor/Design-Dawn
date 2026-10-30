// @vitest-environment jsdom
// Evidence for the pie reader: how mermaid 12.1.0 reads pie charts, and which
// of those inputs the domain (src/domain/diagram/pie/) calls editable. Each case names a
// fact; the test name is the evidence cited in the table. jsdom cannot lay text out, so
// "renders" means the real renderer and the SVG sanitiser accept it, not how it looks.
import { beforeAll, describe, expect, it } from "vitest";
import { pieEditability } from "../../domain/diagram/pie/pie-editability";
import { pieMeaningOf } from "../../domain/diagram/pie/pie-meaning";
import { parsePie } from "../../domain/diagram/pie/pie-parser";
import { createDiagramRenderCheck } from "./diagram-render-check";
import { mermaidRenderer } from "./render-mermaid";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";
import { readPieWithMermaid } from "./test-support/mermaid-pie-db";

beforeAll(installFakeSvgMeasurement);

const renderCheck = createDiagramRenderCheck(mermaidRenderer);

interface GrammarCase {
  readonly name: string;
  readonly source: string;
  // Does mermaid 12.1.0 accept the text?
  readonly mermaid: boolean;
  // Does the domain call it editable? (false for an accepted input = "recognised, not
  // editable", stated on purpose.)
  readonly editable: boolean;
}

const q = (label: string, value: string) => `  "${label}" : ${value}\n`;

const CASES: readonly GrammarCase[] = [
  // header forms
  {
    name: "header: pie",
    source: `pie\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "header: pie showData",
    source: `pie showData\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "header: pie title X",
    source: `pie title Foo\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "header: pie showData title X",
    source: `pie showData title Foo bar\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "header: title X showData is all title text",
    source: `pie title X showData\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "header: showData must be on the header line",
    source: `pie\n  showData\n${q("A", "1")}`,
    mermaid: false,
    editable: false,
  },
  {
    name: "header: tab before showData",
    source: `pie\tshowData\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "header: comment after showData",
    source: `pie showData%% c\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "header: bare pie%% comment (not recognised by the detector)",
    source: `pie%% c\n${q("A", "1")}`,
    mermaid: true,
    editable: false,
  },
  {
    name: "header: keyword is case sensitive",
    source: `PIE\n${q("A", "1")}`,
    mermaid: false,
    editable: false,
  },
  {
    name: "header: a slice on the header line (recognised, not editable)",
    source: 'pie "A" : 1\n  "B" : 2\n',
    mermaid: true,
    editable: false,
  },
  {
    name: "header: showData then a slice on the header line",
    source: 'pie showData "A" : 1\n',
    mermaid: true,
    editable: false,
  },
  {
    name: "header: accTitle on the header line",
    source: `pie accTitle: x\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "header: accDescr block on the header line",
    source: `pie accDescr { x }\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "header: second pie keyword",
    source: `pie\n pie\n${q("A", "1")}`,
    mermaid: false,
    editable: false,
  },
  {
    name: "header: text before pie",
    source: `x\npie\n${q("A", "1")}`,
    mermaid: false,
    editable: false,
  },
  {
    name: "header: indented",
    source: `  pie\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  { name: "header: no slices", source: "pie\n", mermaid: true, editable: true },
  {
    name: "header: no newline at all",
    source: "pie",
    mermaid: true,
    editable: true,
  },
  {
    name: "header: only comments after",
    source: "pie\n %% a\n",
    mermaid: true,
    editable: true,
  },
  // title
  {
    name: "title: own line",
    source: `pie\n  title Foo\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "title: after the slices",
    source: `pie\n${q("A", "1")}  title Foo\n`,
    mermaid: true,
    editable: true,
  },
  {
    name: "title: twice, the last wins",
    source: `pie\n  title Foo\n  title Bar\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "title: empty",
    source: `pie\n  title\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "title: stops at %%",
    source: `pie\n  title Foo %% hi\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "title: tab separator, blanks folded",
    source: `pie\n\ttitle\tFoo  bar  \n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "title: keyword is case sensitive",
    source: `pie\n  Title Foo\n${q("A", "1")}`,
    mermaid: false,
    editable: false,
  },
  {
    name: "title: a colon is not accepted",
    source: `pie\n  title: Foo\n${q("A", "1")}`,
    mermaid: false,
    editable: false,
  },
  {
    name: "title: glued to its text",
    source: `pie\n  titleFoo\n${q("A", "1")}`,
    mermaid: false,
    editable: false,
  },
  {
    name: "title: markup is plain text",
    source: `pie\n  title <b>x</b>\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "title: a quote is plain text",
    source: `pie\n  title say "hi"\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "title: #quot; entity",
    source: `pie\n  title a#quot;b\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "title: front matter title is not the pie title",
    source: `---\ntitle: FM\n---\npie\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "title: statement beats front matter",
    source: `---\ntitle: FM\n---\npie\n  title Own\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "title: inline directive",
    source: `pie\n  title x %%{init: {"theme":"forest"}}%%\n${q("A", "1")}`,
    mermaid: true,
    editable: false,
  },
  // accessibility
  {
    name: "acc: accTitle",
    source: `pie\n  accTitle: My acc\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "acc: accDescr",
    source: `pie\n  accDescr: My descr\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "acc: accDescr multi-line block",
    source: `pie\n  accDescr {\n    line1\n    line2\n  }\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "acc: accDescr block closed with a blank after }",
    source: `pie\n  accDescr {\n a\n  } \n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "acc: accDescr block one line",
    source: `pie\n  accDescr { one }\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "acc: accDescr block with a slice-like line inside",
    source: `pie\n  accDescr {\n  "X" : 9\n  }\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "acc: accTitle with trailing comment",
    source: `pie\n  accTitle: x %% y\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "acc: accDescr twice",
    source: `pie\n  accDescr: a\n  accDescr: b\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  // slice syntax
  {
    name: "slice: plain",
    source: `pie\n${q("A", "1")}${q("B", "2")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "slice: unquoted label",
    source: "pie\n  A : 1\n",
    mermaid: false,
    editable: false,
  },
  {
    name: "slice: single-quoted label is read",
    source: "pie\n  'A' : 1\n",
    mermaid: true,
    editable: true,
  },
  {
    name: "slice: single-quoted label may hold a double quote",
    source: "pie\n  'a\"b' : 1\n",
    mermaid: true,
    editable: true,
  },
  {
    name: "slice: no blanks around the colon",
    source: 'pie\n  "A":1\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "slice: many blanks, tabs",
    source: 'pie\n  "A"   :\t1\t\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "slice: two on one line",
    source: 'pie\n  "A" : 1 "B" : 2\n',
    mermaid: false,
    editable: false,
  },
  {
    name: "slice: trailing comment",
    source: 'pie\n  "A" : 1 %% c\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "slice: comment glued to the value",
    source: 'pie\n "A" : 1.5%%c\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "slice: trailing garbage",
    source: 'pie\n  "A" : 1 x\n',
    mermaid: false,
    editable: false,
  },
  {
    name: "slice: missing value",
    source: 'pie\n "A" :\n',
    mermaid: false,
    editable: false,
  },
  {
    name: "slice: missing colon",
    source: 'pie\n "A" 1\n',
    mermaid: false,
    editable: false,
  },
  {
    name: "slice: double colon",
    source: 'pie\n "A" :: 1\n',
    mermaid: false,
    editable: false,
  },
  {
    name: "slice: last line without a newline",
    source: 'pie\n  "A" : 1',
    mermaid: true,
    editable: true,
  },
  {
    name: "slice: CRLF",
    source: 'pie\r\n  "A" : 1\r\n  "B" : 2\r\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "slice: mixed line endings",
    source: 'pie\r\n "A":1\n "B":2\r\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "slice: blank lines around",
    source: '\n\npie\n\n  "A" : 1\n\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "slice: comment lines",
    source: 'pie\n  %% c\n  "A" : 1\n%%c\n  "B" : 2\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "slice: init directive before the header",
    source: `%%{init: {"theme":"forest"}}%%\npie\n${q("A", "1")}`,
    mermaid: true,
    editable: true,
  },
  {
    name: "slice: front matter with config",
    source: `---\ntitle: Pets chart\nconfig:\n  pie:\n    textPosition: 0.5\n---\n%%{init: {"theme":"forest"}}%%\npie showData\n  %% a comment\n${q("A", "1")}\n  %% another\n${q("B", "2")}`,
    mermaid: true,
    editable: true,
  },
  // whitespace Mermaid's lexer does not accept
  {
    name: "ws: no-break space before a slice",
    source: 'pie\n\u00a0 "A" : 1\n',
    mermaid: false,
    editable: false,
  },
  {
    name: "ws: a line holding only a no-break space",
    source: 'pie\n\u00a0\n "A" : 1\n',
    mermaid: false,
    editable: false,
  },
  {
    name: "ws: form feed before a slice",
    source: 'pie\n\f"A" : 1\n',
    mermaid: false,
    editable: false,
  },
  {
    name: "ws: a lone CR is a line break for mermaid (recognised, not editable)",
    source: 'pie\n  "A" : 1\r  "B" : 2\n',
    mermaid: true,
    editable: false,
  },
  // labels
  {
    name: "label: empty",
    source: 'pie\n  "" : 1\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "label: spaces are kept, not trimmed",
    source: 'pie\n  "  A b  " : 1\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "label: spaced variants are different slices",
    source: 'pie\n  "A" : 1\n  " A " : 3\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "label: tab inside",
    source: 'pie\n  "A\tB" : 1\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "label: line break inside a string (recognised, not editable)",
    source: 'pie\n  "A\nB" : 1\n',
    mermaid: true,
    editable: false,
  },
  {
    name: "label: backslash is an escape (recognised, not editable)",
    source: 'pie\n  "a\\nb" : 1\n',
    mermaid: true,
    editable: false,
  },
  {
    name: "label: backslash-quote (recognised, not editable)",
    source: 'pie\n  "a\\"b" : 1\n',
    mermaid: true,
    editable: false,
  },
  {
    name: "label: #quot; entity is kept as written in the db",
    source: 'pie\n  "a#quot;b" : 1\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "label: #amp; and #35; entities",
    source: 'pie\n  "a#amp;b#35;c" : 1\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "label: unknown entity name",
    source: 'pie\n  "a#foo;b" : 1\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "label: a lone #",
    source: 'pie\n  "a#b" : 1\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "label: %% inside is plain text",
    source: 'pie\n  "x %% y" : 1\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "label: %% {a} with a blank is not a directive",
    source: 'pie\n  "x %% {a} y" : 1\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "label: %%{...}%% is removed from inside the label",
    source: 'pie\n  "x %%{init: {\\"theme\\":\\"forest\\"}}%% y" : 1\n',
    mermaid: true,
    editable: false,
  },
  {
    name: "label: markup, brackets, colon, semicolon, emoji",
    source:
      'pie\n  "<b>x</b>" : 1\n  "a];b" : 1\n  "a : b" : 1\n  "a;b" : 1\n  "a<br/>b" : 1\n  "犬🐶" : 1\n',
    mermaid: true,
    editable: true,
  },
  {
    name: 'label: <tag attr="v"> is rewritten before parsing (recognised, not editable)',
    source: 'pie\n  "<a href="q">x" : 1\n',
    mermaid: true,
    editable: false,
  },
  // duplicates
  {
    name: "dup: first slice wins, later dropped (recognised, not editable)",
    source: 'pie\n  "A" : 1\n  "B" : 2\n  "A" : 3\n',
    mermaid: true,
    editable: false,
  },
  {
    name: "dup: entity labels compare by their written form",
    source: 'pie\n  "a#quot;b" : 1\n  "a#quot;b" : 2\n',
    mermaid: true,
    editable: false,
  },
  {
    name: "dup: #35; labels",
    source: 'pie\n "a#35;b" : 1\n "a#35;b" : 2\n',
    mermaid: true,
    editable: false,
  },
  // numbers
  {
    name: "number: zero",
    source: 'pie\n  "A" : 0\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "number: -0 is accepted as 0",
    source: 'pie\n  "A" : -0\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "number: negative integer",
    source: 'pie\n  "A" : -1\n',
    mermaid: false,
    editable: false,
  },
  {
    name: "number: negative decimal",
    source: 'pie\n  "A" : -0.5\n',
    mermaid: false,
    editable: false,
  },
  {
    name: "number: plus sign",
    source: 'pie\n  "A" : +1\n',
    mermaid: false,
    editable: false,
  },
  {
    name: "number: decimal keeps trailing zeros in the text",
    source: 'pie\n  "A" : 1.50\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "number: 0.5",
    source: 'pie\n  "A" : 0.5\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "number: leading zeros in the integer part of a decimal",
    source: 'pie\n "A" : 00.5\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "number: leading dot",
    source: 'pie\n  "A" : .5\n',
    mermaid: false,
    editable: false,
  },
  {
    name: "number: trailing dot",
    source: 'pie\n  "A" : 1.\n',
    mermaid: false,
    editable: false,
  },
  {
    name: "number: exponent",
    source: 'pie\n  "A" : 1e3\n',
    mermaid: false,
    editable: false,
  },
  {
    name: "number: leading zeros in an integer",
    source: 'pie\n  "A" : 007\n',
    mermaid: false,
    editable: false,
  },
  {
    name: "number: comma",
    source: 'pie\n  "A" : 1,5\n',
    mermaid: false,
    editable: false,
  },
  {
    name: "number: very large but finite",
    source: 'pie\n  "A" : 12345678901234567890\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "number: very small",
    source: 'pie\n  "A" : 0.000000000000000000001\n',
    mermaid: true,
    editable: true,
  },
  {
    name: "number: too large for a double (recognised, not editable)",
    source: `pie\n "A" : 1${"0".repeat(400)}\n`,
    mermaid: true,
    editable: false,
  },
  // rewritten text
  {
    name: "rewrite: style-like text loses its last ; (recognised, not editable)",
    source: 'pie\n  "style x:#a; y" : 1\n',
    mermaid: true,
    editable: false,
  },
];

describe("pie grammar of mermaid 12.1.0", () => {
  it.each(CASES.map((entry) => [entry.name, entry] as const))(
    "%s",
    async (_name, entry) => {
      const reading = await readPieWithMermaid(entry.source);
      expect(reading.accepted, "mermaid").toBe(entry.mermaid);

      const parsed = parsePie(entry.source);
      const editability = pieEditability(parsed);
      expect(editability.editable, JSON.stringify(editability)).toBe(
        entry.editable,
      );

      if (editability.editable) {
        // The invariant the whole editor stands on: what we call editable is accepted by
        // mermaid, and our reading of it equals mermaid's own.
        expect(reading.accepted).toBe(true);
        if (reading.accepted) {
          expect(pieMeaningOf(parsed)).toEqual(reading.meaning);
        }
        expect(await renderCheck(entry.source)).toEqual({ ok: true });
      }
      if (!reading.accepted) {
        expect(editability.editable).toBe(false);
      }
    },
  );
});
