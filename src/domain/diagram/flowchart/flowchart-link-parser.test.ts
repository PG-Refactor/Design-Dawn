import { describe, expect, it } from "vitest";
import { readFlowchart } from "./flowchart-reader";

const f = (body: string) => `flowchart TD\n${body}\n`;
const reasons = (body: string) =>
  readFlowchart(f(body)).opaque.map((entry) => entry.reason);
const linkOf = (body: string) => {
  const reading = readFlowchart(f(body));
  expect(reading.opaque).toEqual([]);
  const statement = reading.statements.find(
    (candidate) => candidate.kind === "edge",
  );
  if (statement === undefined || statement.kind !== "edge") {
    throw new Error("no edge");
  }
  const link = statement.links[0];
  if (link === undefined) throw new Error("no link");
  return link;
};

describe("links with their text inside", () => {
  it.each([
    ["x-- text --x", "double_arrow_cross"],
    ["o-- text --o", "double_arrow_circle"],
    ["<-- text -->", "double_arrow_point"],
    ["== text ==>", "arrow_point"],
    ["-. text .->", "arrow_point"],
    ['-- "quoted text" -->', "arrow_point"],
  ])("reads A %s B", (link, type) => {
    expect(linkOf(`A ${link} B`).type).toBe(type);
  });

  it.each([
    ["a different stroke at the end", "A -- text ==> B", "invalidLink"],
    ["a mark that does not match", "A x-- text --o B", "mismatchedInlineLink"],
    ["no end after a quoted text", 'A -- "text" B', "invalidLink"],
    ["no end at all", "A -- text B", "invalidLink"],
    ["an empty quoted text", 'A -- "" --> B', "emptyLabel"],
    ["a quoted text with a backtick", 'A -- "a`b" --> B', "backtickInLabel"],
    [
      "an unquoted text with a forbidden character",
      "A -- a|b --> B",
      "specialCharsInLabel",
    ],
  ])("refuses %s", (_what, body, reason) => {
    expect(reasons(body)).toContain(reason);
  });
});

describe("|text| after a link", () => {
  it("reads a quoted text", () => {
    expect(linkOf('A -->|"yes"| B').label?.label.value).toBe("yes");
  });

  it.each([
    ["text after the quoted part", 'A -->|"yes" x| B', "invalidEdgeLabel"],
    ["an empty quoted text", 'A -->|""| B', "emptyLabel"],
    ["a backtick in a quoted text", 'A -->|"a`b"| B', "backtickInLabel"],
    ["an unquoted text of blanks", "A -->| | B", "emptyLabel"],
  ])("refuses %s", (_what, body, reason) => {
    expect(reasons(body)).toContain(reason);
  });
});

describe("edge ids", () => {
  it("reads an edge id before a link, and an id-like word at the end as a node", () => {
    expect(linkOf("A e1@--> B").edgeId?.text).toBe("e1");
    expect(reasons("A e1@")).not.toContain("edgeIdSwallowsNode");
  });

  it("does not take a word followed by @ and something else for an edge id", () => {
    // `e1@x` is not an edge id before a link: the line is not a link at all.
    expect(reasons("A e1@x B")).toContain("invalidLink");
    expect(reasons("A e1@ --> B").length).toBeGreaterThan(0);
  });

  it("refuses an edge id that is not a node id Mermaid accepts", () => {
    expect(reasons("A default@--> B")).toContain("reservedId");
  });
});
