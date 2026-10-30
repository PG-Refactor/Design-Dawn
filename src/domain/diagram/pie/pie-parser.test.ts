import { describe, expect, it } from "vitest";
import { loadMermaidGuiFixtures } from "../test-fixtures";
import { pieEditability } from "./pie-editability";
import { pieMeaningOf } from "./pie-meaning";
import { type ParsedPie, parsePie } from "./pie-parser";

const kindsOf = (parsed: ParsedPie) => parsed.lines.map((line) => line.kind);

// Every range the parse reports must point at exactly the text it names, and the lines must
// give the source back: the parse is lossless.
function expectLossless(source: string): ParsedPie {
  const parsed = parsePie(source);
  expect(parsed.source).toBe(source);
  expect(parsed.lines.map((line) => line.text + line.terminator).join("")).toBe(
    source,
  );
  for (const slice of parsed.slices) {
    expect(source.slice(slice.labelSpan.start, slice.labelSpan.end)).toBe(
      slice.labelText,
    );
    expect(source.slice(slice.valueSpan.start, slice.valueSpan.end)).toBe(
      slice.valueText,
    );
    expect(source.charAt(slice.labelSpan.start - 1)).toBe(slice.quote);
    expect(source.charAt(slice.labelSpan.end)).toBe(slice.quote);
  }
  for (const title of parsed.titles) {
    expect(source.slice(title.keywordSpan.start, title.keywordSpan.end)).toBe(
      "title",
    );
    expect(source.slice(title.textSpan.start, title.textSpan.end).trim()).toBe(
      source.slice(title.textSpan.start, title.textSpan.end),
    );
  }
  if (parsed.header !== null) {
    const { keywordSpan, showDataSpan } = parsed.header;
    expect(source.slice(keywordSpan.start, keywordSpan.end)).toBe("pie");
    if (showDataSpan !== null) {
      expect(source.slice(showDataSpan.start, showDataSpan.end)).toBe(
        "showData",
      );
    }
  }
  return parsed;
}

describe("parsePie", () => {
  it("classifies every line of a rich chart", () => {
    const source = [
      "---",
      "title: FM",
      "---",
      '%%{init: {"theme":"forest"}}%%',
      "pie showData title Pets",
      "  %% comment",
      "",
      "  accTitle: t",
      "  accDescr: d",
      "  accDescr {",
      "    more",
      "  }",
      "  title Own",
      '  "Dogs" : 386',
      "  'Cats' : 85.5 %% note",
      "",
    ].join("\n");
    const parsed = expectLossless(source);
    expect(kindsOf(parsed)).toEqual([
      "frontMatter",
      "frontMatter",
      "frontMatter",
      "directive",
      "header",
      "comment",
      "blank",
      "accTitle",
      "accDescr",
      "accDescr",
      "accDescr",
      "accDescr",
      "title",
      "slice",
      "slice",
    ]);
    expect(parsed.header).toMatchObject({ lineIndex: 4, showData: true });
    expect(
      parsed.titles.map((title) => [title.onHeaderLine, title.text]),
    ).toEqual([
      [true, "Pets"],
      [false, "Own"],
    ]);
    expect(
      parsed.slices.map((slice) => [slice.label, slice.quote, slice.value]),
    ).toEqual([
      ["Dogs", '"', 386],
      ["Cats", "'", 85.5],
    ]);
    expect(parsed.unsupported).toEqual([]);
    expect(pieEditability(parsed)).toEqual({ editable: true });
    expect(pieMeaningOf(parsed)).toEqual({
      title: "Own",
      showData: true,
      slices: [
        { label: "Dogs", value: 386 },
        { label: "Cats", value: 85.5 },
      ],
    });
  });

  it("reads header options", () => {
    expect(expectLossless("pie\n").header?.showData).toBe(false);
    expect(expectLossless("pie showData\n").header?.showData).toBe(true);
    const titled = expectLossless("pie  showData\ttitle  A   B  %% c\n");
    expect(titled.header?.showData).toBe(true);
    expect(titled.titles).toHaveLength(1);
    // Mermaid folds the blanks of a title; the span keeps the written text.
    expect(titled.titles[0]?.text).toBe("A B");
    expect(
      titled.source.slice(
        titled.titles[0]?.textSpan.start,
        titled.titles[0]?.textSpan.end,
      ),
    ).toBe("A   B");
  });

  it("keeps the written text of the label and the value", () => {
    // Mermaid accepts leading zeros in a decimal (but not in an integer).
    const parsed = expectLossless(
      'pie\n  "犬 🐶 #quot;x#quot;" :   007.50  \n',
    );
    expect(parsed.slices[0]).toMatchObject({
      labelText: "犬 🐶 #quot;x#quot;",
      label: "犬 🐶 #quot;x#quot;",
      valueText: "007.50",
      value: 7.5,
    });
  });

  it.each([
    ["no quotes", "pie\n  A : 1\n", "unknownStatement"],
    ["no value", 'pie\n  "A" :\n', "invalidValue"],
    ["no colon", 'pie\n  "A" 1\n', "invalidSliceSyntax"],
    ["trailing text", 'pie\n  "A" : 1 x\n', "invalidSliceSyntax"],
    ["two slices on a line", 'pie\n  "A" : 1 "B" : 2\n', "invalidSliceSyntax"],
    ["negative", 'pie\n  "A" : -1\n', "negativeValue"],
    ["negative decimal", 'pie\n  "A" : -0.5\n', "negativeValue"],
    ["exponent", 'pie\n  "A" : 1e3\n', "invalidSliceSyntax"],
    ["leading dot", 'pie\n  "A" : .5\n', "invalidValue"],
    ["trailing dot", 'pie\n  "A" : 1.\n', "invalidSliceSyntax"],
    ["leading zero", 'pie\n  "A" : 01\n', "invalidSliceSyntax"],
    ["too large", `pie\n  "A" : 1${"0".repeat(400)}\n`, "valueOutOfRange"],
    ["backslash", 'pie\n  "a\\nb" : 1\n', "backslashInLabel"],
    ["unterminated string", 'pie\n  "A : 1\n', "invalidSliceSyntax"],
    ["showData on its own line", "pie\n  showData\n", "unknownStatement"],
    ["title colon", "pie\n  title: x\n", "unknownStatement"],
    ["glued title", "pie\n  titleX\n", "unknownStatement"],
    ["bare accDescr", "pie\n  accDescr\n", "unknownStatement"],
    [
      "accDescr block with text after }",
      'pie\n  accDescr { a } "A" : 1\n',
      "invalidAccessibilitySyntax",
    ],
    [
      "unterminated accDescr block",
      'pie\n  accDescr {\n  "A" : 1\n',
      "unterminatedAccessibilityBlock",
    ],
    ["slice on the header line", 'pie "A" : 1\n', "sliceOnHeaderLine"],
    ["no-break space", "pie\n\u00a0\n", "nonAsciiWhitespace"],
    ["no-break space indent", 'pie\n\u00a0 "A" : 1\n', "unknownStatement"],
  ])("marks a malformed or unsupported line: %s", (_name, source, reason) => {
    const parsed = expectLossless(source);
    expect(parsed.unsupported.map((entry) => entry.reason)).toContain(reason);
    const editability = pieEditability(parsed);
    expect(editability).toMatchObject({
      editable: false,
      reason: "unsupportedLines",
    });
  });

  it("lists every unsupported line in the reason", () => {
    const parsed = parsePie('pie\n  oops\n  "A" : 1\n  "B" : x\n');
    const editability = pieEditability(parsed);
    expect(editability).toMatchObject({
      editable: false,
      reason: "unsupportedLines",
      detail: "line 2 (unknownStatement), line 4 (invalidValue)",
    });
    expect(
      editability.editable ? [] : editability.lines.map((line) => line.index),
    ).toEqual([1, 3]);
  });

  it("is not a pie chart for other types, an empty source or broken structure", () => {
    for (const source of [
      "",
      "graph TD\nA-->B\n",
      "---\npie\n",
      "%%{init:\npie\n",
    ]) {
      const parsed = parsePie(source);
      expect(parsed.isPie).toBe(false);
      expect(parsed.slices).toEqual([]);
      expect(pieEditability(parsed)).toMatchObject({
        editable: false,
        reason: "notPie",
      });
    }
  });

  it("handles CRLF, mixed endings and a last line without a newline", () => {
    for (const source of [
      'pie\r\n  "A" : 1\r\n  "B" : 2\r\n',
      'pie\r\n  "A" : 1\n  "B" : 2',
      'pie\n  "A" : 1',
    ]) {
      const parsed = expectLossless(source);
      expect(parsed.slices.map((slice) => slice.label)).toEqual(
        source.includes('"B"') ? ["A", "B"] : ["A"],
      );
      expect(pieEditability(parsed)).toEqual({ editable: true });
    }
  });

  it("does not let an accDescr block swallow or release slices wrongly", () => {
    const parsed = expectLossless(
      'pie\n  accDescr {\n  "X" : 9\n  }\n  "A" : 1\n',
    );
    expect(parsed.slices.map((slice) => slice.label)).toEqual(["A"]);
    expect(pieMeaningOf(parsed).slices).toEqual([{ label: "A", value: 1 }]);
  });

  describe("what blocks editing, and what does not", () => {
    it.each([
      ["a duplicated label", 'pie\n  "A" : 1\n  "A" : 2\n', "duplicateLabels"],
      [
        "a lone carriage return",
        'pie\n  %% c\r  x\n  "A" : 1\n',
        "loneCarriageReturn",
      ],
      [
        "markup Mermaid rewrites",
        'pie\n  title <a href="q">x\n  "A" : 1\n',
        "markupRewrite",
      ],
      ["style-like text", 'pie\n  "style x:#a; y" : 1\n', "styleLikeText"],
      [
        "an inline directive",
        'pie\n  "A" : 1 %%{init: {}}%%\n',
        "inlineDirective",
      ],
    ])("blocks on %s", (_name, source, reason) => {
      expect(pieEditability(parsePie(source))).toMatchObject({
        editable: false,
        reason,
      });
    });

    it("blocks a duplicate by its written form, not by trimmed or decoded text", () => {
      expect(pieEditability(parsePie('pie\n "A" : 1\n " A " : 2\n'))).toEqual({
        editable: true,
      });
      expect(
        pieEditability(parsePie('pie\n "a#quot;b" : 1\n "a#quot;b" : 2\n')),
      ).toMatchObject({
        reason: "duplicateLabels",
      });
    });

    it("lets recognised, independent statements through", () => {
      const source =
        '---\ntitle: T\n---\n%%{init: {}}%%\npie showData title X\n  %% c\n  accTitle: a\n  accDescr: d\n  accDescr {\n   b\n  }\n  title Y\n  "A" : 1\n';
      expect(pieEditability(parsePie(source))).toEqual({ editable: true });
    });
  });

  it("derives Mermaid's meaning: the first of a repeated label wins", () => {
    const meaning = pieMeaningOf(
      parsePie('pie\n  "A" : 1\n  "B" : 2\n  "A" : 3\n'),
    );
    expect(meaning.slices).toEqual([
      { label: "A", value: 1 },
      { label: "B", value: 2 },
    ]);
  });

  it("agrees with the shared fixtures: every pie fixture is lossless", () => {
    const pieFixtures = loadMermaidGuiFixtures().filter(
      (fixture) => fixture.diagram === "pie",
    );
    expect(pieFixtures.length).toBeGreaterThan(0);
    for (const fixture of pieFixtures) {
      expectLossless(fixture.source);
      if (!fixture.mermaidParses) {
        expect(
          pieEditability(parsePie(fixture.source)).editable,
          fixture.id,
        ).toBe(false);
      }
    }
  });
});
