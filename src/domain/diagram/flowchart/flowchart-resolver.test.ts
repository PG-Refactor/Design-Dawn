import { describe, expect, it } from "vitest";
import { readFlowchart } from "./flowchart-reader";

const f = (body: string) => `flowchart TD\n${body}\n`;
const reasons = (body: string) =>
  readFlowchart(f(body)).opaque.map((entry) => entry.reason);

describe("@{ } values on a node", () => {
  it("reads a label type it knows", () => {
    expect(reasons('A@{ label: "x", labelType: markdown }')).toEqual([]);
  });

  it.each([
    ["a quoted shape", 'A@{ shape: "cyl" }'],
    ["an unquoted label", "A@{ label: Text }"],
    ["a quoted label type", 'A@{ labelType: "markdown" }'],
    ["a label type it does not know", "A@{ labelType: rich }"],
  ])("refuses %s", (_what, body) => {
    expect(reasons(body)).toContain("atBlockUnsupportedValue");
  });
});

describe("@{ } values on an edge", () => {
  it("reads animate and curve", () => {
    expect(reasons("A e1@--> B\ne1@{ animate: true, curve: basis }")).toEqual(
      [],
    );
  });

  it.each([
    [
      "a key it does not know",
      "A e1@--> B\ne1@{ color: red }",
      "atBlockUnsupportedKey",
    ],
    [
      "a quoted value",
      'A e1@--> B\ne1@{ curve: "basis" }',
      "atBlockUnsupportedValue",
    ],
    [
      "animate that is not true or false",
      "A e1@--> B\ne1@{ animate: yes }",
      "atBlockUnsupportedValue",
    ],
    [
      "a curve that looks like a boolean",
      "A e1@--> B\ne1@{ curve: true }",
      "atBlockUnsupportedValue",
    ],
    [
      "a curve that looks like null",
      "A e1@--> B\ne1@{ curve: null }",
      "atBlockUnsupportedValue",
    ],
    [
      "a curve that is not a word",
      "A e1@--> B\ne1@{ curve: 1.5 }",
      "atBlockUnsupportedValue",
    ],
  ])("refuses %s", (_what, body, reason) => {
    expect(reasons(body)).toContain(reason);
  });
});

describe("resolving statements", () => {
  it("gives a second use of an edge id an automatic one", () => {
    const edges = readFlowchart(f("A e1@--> B\nC e1@--> D")).meaning?.edges;
    expect(edges?.map((edge) => edge.id)).toEqual(["e1", "L_C_D_0"]);
  });

  it("keeps the written edge when an automatic id is the same", () => {
    const edges = readFlowchart(f("X L_A_B_0@--> Y\nA --> B")).meaning?.edges;
    expect(edges?.map((edge) => edge.id)).toEqual(["L_A_B_0", "L_A_B_0"]);
  });

  it("does not make a subgraph a member of itself", () => {
    const meaning = readFlowchart(f("subgraph S\nS\nA\nend")).meaning;
    expect(meaning?.subgraphs[0]?.members).not.toContain("S");
  });

  it("refuses a style aimed at an edge id", () => {
    expect(reasons("A e1@--> B\nstyle e1 fill:red")).toContain(
      "edgeIdSwallowsNode",
    );
  });

  it("adds fill:none to a link style without a fill, and keeps one that has it", () => {
    const styleOf = (body: string) =>
      readFlowchart(f(body)).meaning?.edges[0]?.style;
    expect(styleOf("A-->B\nlinkStyle 0 stroke:red")).toContain("fill:none");
    expect(styleOf("A-->B\nlinkStyle 0 fill:blue,stroke:red")).not.toContain(
      "fill:none",
    );
  });
});
