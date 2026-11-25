import { describe, expect, it } from "vitest";
import { readFlowchart } from "./flowchart-reader";
import { splitStyleItems } from "./flowchart-statement-parser";
import type { FlowchartStatement } from "./flowchart-types";

const f = (body: string) => `flowchart TD\n${body}\n`;

// The opaque reasons of a flowchart, empty when everything was read.
const reasons = (body: string) =>
  readFlowchart(f(body)).opaque.map((entry) => entry.reason);

function statementOf<Kind extends FlowchartStatement["kind"]>(
  body: string,
  kind: Kind,
): Extract<FlowchartStatement, { kind: Kind }> {
  const reading = readFlowchart(f(body));
  expect(reading.opaque).toEqual([]);
  const found = reading.statements.find((statement) => statement.kind === kind);
  if (found === undefined) throw new Error(`no ${kind} statement`);
  return found as Extract<FlowchartStatement, { kind: Kind }>;
}

describe("style texts", () => {
  it("cuts at commas, refusing an escaped comma or an empty piece", () => {
    expect(splitStyleItems("stroke:red, fill:blue")).toEqual([
      "stroke:red",
      " fill:blue",
    ]);
    expect(splitStyleItems("a\\,b")).toBeNull();
    expect(splitStyleItems("a,,b")).toBeNull();
  });

  it.each([
    ["no blank before the text", "A\nstyle A"],
    ["nothing after the target", "A\nstyle A "],
    ["a character outside the alphabet", "A\nstyle A fill:(red)"],
    ["a comment mark", "A\nstyle A fill:%%red"],
    ["a keyword inside", "A\nstyle A fill:linkStyle"],
    ["an empty piece", "A\nstyle A fill:red,,x"],
  ])("refuses a style with %s", (_what, body) => {
    expect(reasons(body).length).toBeGreaterThan(0);
  });

  it("reads a style for several class names in classDef", () => {
    expect(statementOf("classDef a,b fill:red", "classDef").names).toHaveLength(
      2,
    );
    expect(reasons("classDef a, fill:red")).toContain("unsupportedClassDef");
  });

  it("reads class for several nodes, and refuses a bad list", () => {
    expect(statementOf("A\nB\nclass A,B k", "class").targets).toHaveLength(2);
    expect(reasons("A\nclass A,")).toContain("unsupportedClass");
    expect(reasons("A\nclass A,B")).toContain("unsupportedClass");
  });

  it("refuses a style whose target list is broken", () => {
    expect(reasons("A\nstyle A, fill:red")).toContain("unsupportedStyle");
  });
});

describe("subgraph headers", () => {
  it("reads a title in brackets, quoted or not", () => {
    expect(
      statementOf("subgraph S [Title]\nend", "subgraphStart").title,
    ).not.toBeNull();
    expect(
      statementOf('subgraph S ["Quoted title"]\nend', "subgraphStart").title,
    ).not.toBeNull();
  });

  it.each([
    [
      "a title not in brackets",
      "subgraph S title\nend",
      "unsupportedSubgraphHeader",
    ],
    [
      "text after the title",
      "subgraph S [t] x\nend",
      "unsupportedSubgraphHeader",
    ],
    [
      "a quoted title not closed by its bracket",
      'subgraph S ["t" x]\nend',
      "unterminatedBracket",
    ],
    ["a bracket never closed", "subgraph S [t\nend", "unterminatedBracket"],
    ["a quote never closed", 'subgraph S ["t\nend', "unterminatedQuote"],
    ["an empty quoted title", 'subgraph S [""]\nend', "emptyLabel"],
    [
      "special characters in the title",
      "subgraph S [a (b)]\nend",
      "specialCharsInLabel",
    ],
    [
      "blanks after the header",
      "subgraph S \nend",
      "unsupportedSubgraphHeader",
    ],
    ["a bad id", "subgraph end-x\nend", "keywordLikeId"],
  ])("refuses %s", (_what, body, reason) => {
    expect(reasons(body)).toContain(reason);
  });
});

describe("linkStyle", () => {
  it("reads indexes, default, interpolate and a style", () => {
    const styled = statementOf(
      "A-->B\nB-->C\nlinkStyle 0,1 stroke:red",
      "linkStyle",
    );
    expect(styled.indexes).toEqual([0, 1]);
    expect(
      statementOf("A-->B\nlinkStyle default stroke:red", "linkStyle")
        .appliesToDefault,
    ).toBe(true);
    const curved = statementOf(
      "A-->B\nlinkStyle 0 interpolate basis",
      "linkStyle",
    );
    expect(curved.interpolate?.text).toBe("basis");
    expect(curved.styleText).toBeNull();
    expect(
      statementOf(
        "A-->B\nlinkStyle 0 interpolate basis stroke:red",
        "linkStyle",
      ).styleText?.text,
    ).toBe("stroke:red");
  });

  it.each([
    ["no index", "A-->B\nlinkStyle x stroke:red"],
    ["an index with a leading zero", "A-->B\nlinkStyle 01 stroke:red"],
    ["no blank after the indexes", "A-->B\nlinkStyle 0stroke:red"],
    ["interpolate without a curve", "A-->B\nlinkStyle 0 interpolate :x"],
    ["no blank after the curve", "A-->B\nlinkStyle 0 interpolate basis:x"],
    ["a style it does not read", "A-->B\nlinkStyle 0 stroke:(red)"],
    ["blanks at the end", "A-->B\nlinkStyle 0 stroke:red "],
  ])("refuses %s", (_what, body) => {
    expect(reasons(body)).toContain("unsupportedLinkStyle");
  });
});

describe("click", () => {
  it("reads a link with a tooltip and a target, and the href form", () => {
    const link = statementOf(
      'A\nclick A "https://example.com" "Open it" _blank',
      "click",
    );
    expect(link.form).toBe("link");
    expect(link.url?.text).toBe("https://example.com");
    expect(link.tooltip?.text).toBe("Open it");
    const href = statementOf('A\nclick A href "https://example.com"', "click");
    expect(href.form).toBe("href");
    expect(href.tooltip).toBeNull();
  });

  it("leaves a quote that is never closed to the statement splitting", () => {
    expect(reasons('A\nclick A "https://x')).toContain("unterminatedQuote");
    expect(reasons('A\nclick A "https://x.com" "tip')).toContain(
      "unterminatedQuote",
    );
  });

  it("reads call and callback forms, with or without a tooltip", () => {
    const call = statementOf('A\nclick A call open(1, x) "Tip"', "click");
    expect(call.form).toBe("call");
    expect(call.tooltip?.text).toBe("Tip");
    expect(statementOf("A\nclick A call open()", "click").tooltip).toBeNull();
    const callback = statementOf('A\nclick A onClick "Tip"', "click");
    expect(callback.form).toBe("callback");
    expect(callback.tooltip?.text).toBe("Tip");
    expect(statementOf("A\nclick A onClick", "click").tooltip).toBeNull();
  });

  it.each([
    ["a link that is not a URL", 'A\nclick A "not a url"'],
    ["an empty tooltip", 'A\nclick A "https://x.com" ""'],
    ["a target it does not know", 'A\nclick A "https://x.com" _nowhere'],
    ["text right after the link", 'A\nclick A "https://x.com"x'],
    ["href without a link", "A\nclick A href fn"],
    ["a call it cannot read", "A\nclick A call open("],
    ["a callback it cannot read", "A\nclick A on-click"],
    ["no blank after the target", 'A\nclick A"https://x.com"'],
    ["nothing after the target", "A\nclick A"],
    ["a broken target list", 'A\nclick A, "https://x.com"'],
    ["a tab between its parts", 'A\nclick A\t"https://x.com"'],
    ["two blanks between its parts", 'A\nclick A  "https://x.com"'],
  ])("refuses %s", (_what, body) => {
    expect(reasons(body)).toContain("unsupportedClick");
  });
});

describe("groups with &", () => {
  it("needs a blank after the ampersand", () => {
    expect(readFlowchart(f("A & B --> C")).opaque).toEqual([]);
    expect(reasons("A &B --> C").length).toBeGreaterThan(0);
  });
});
