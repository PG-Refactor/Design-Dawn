import { describe, expect, it } from "vitest";
import { readFlowchart } from "./flowchart-reader";

const f = (body: string) => `flowchart TD\n${body}\n`;
const reasons = (body: string) =>
  readFlowchart(f(body)).opaque.map((entry) => entry.reason);

const NO_BREAK_SPACE = " ";

describe("node terms", () => {
  it.each([
    [
      "a no-break space where a term starts",
      `A-->${NO_BREAK_SPACE}B`,
      "nonAsciiWhitespace",
    ],
    [
      "a no-break space after an id",
      `A${NO_BREAK_SPACE}-->B`,
      "nonAsciiWhitespace",
    ],
    ["an id ending in a dot", "A. --> B", "unsupportedId"],
    ["a backtick inside a quoted label", 'A["a`b"]', "backtickInLabel"],
    ["an empty quoted label", 'A[""]', "emptyLabel"],
    ["a shape never closed", "A(x", "unterminatedBracket"],
    [
      "a quoted label not closed by its bracket",
      'A["x" ]',
      "unterminatedBracket",
    ],
  ])("refuses %s", (_what, body, reason) => {
    expect(reasons(body)).toContain(reason);
  });

  it("reads a markdown label, a shape, dotted ids and labels Mermaid keeps as written", () => {
    expect(reasons('A["`**bold**`"]')).toEqual([]);
    expect(reasons("A([stadium])")).toEqual([]);
    // The closer that comes first decides the shape, whichever is listed first.
    expect(reasons("A[/x/] --> B[/y\\]")).toEqual([]);
    expect(reasons("A[/x\\] --> B[/y/]")).toEqual([]);
    expect(reasons("A.x-->B")).toEqual([]);
    expect(reasons("A[ ]")).toEqual([]);
    expect(reasons(`A[a${NO_BREAK_SPACE}b]`)).toEqual([]);
  });
});

describe("@{ } blocks", () => {
  it("reads a shape and a quoted label, blanks around the colon and a comma at the end", () => {
    expect(reasons('A@{ shape: cyl, label: "Store" }')).toEqual([]);
    expect(reasons("A@{ shape : cyl }")).toEqual([]);
    expect(reasons("A@{ shape: cyl, }")).toEqual([]);
  });

  it.each([
    ["a part without a colon", "A@{ shape }", "atBlockMalformed"],
    ["a key that is not a word", "A@{ 1x: cyl }", "atBlockMalformed"],
    ["no blank after the colon", "A@{ shape:cyl }", "atBlockMalformed"],
    ["a key without a value", 'A@{ shape: , label: "x" }', "atBlockMalformed"],
    ["text after a quoted value", 'A@{ label: "x"y }', "atBlockMalformed"],
    [
      "a quote inside a quoted value",
      'A@{ label: "a""b" }',
      "atBlockMalformed",
    ],
    ["an empty quoted value", 'A@{ label: "" }', "atBlockUnsupportedValue"],
    ["a single-quoted value", "A@{ label: 'x' }", "atBlockUnsupportedValue"],
    ["braces inside", "A@{ label: {x} }", "atBlockMalformed"],
  ])("refuses %s", (_what, body, reason) => {
    expect(reasons(body)).toContain(reason);
  });
});
