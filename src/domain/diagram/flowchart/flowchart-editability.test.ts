import { describe, expect, it } from "vitest";
import {
  FLOWCHART_MAX_EDGES,
  FLOWCHART_MAX_SOURCE_LENGTH,
} from "./flowchart-config";
import { flowchartEditability } from "./flowchart-editability";
import { assessFlowchart } from "./flowchart-editor";
import { readFlowchart } from "./flowchart-reader";

const f = (body: string) => `flowchart TD\n${body}\n`;
const check = (source: string) => flowchartEditability(readFlowchart(source));
const reasonOf = (source: string) => {
  const result = check(source);
  return result.editable ? "editable" : result.reason;
};

function edges(count: number): string {
  return `flowchart LR\n${Array.from({ length: count }, (_v, i) => `N${i}-->N${i + 1}`).join("\n")}\n`;
}
function ofLength(length: number): string {
  const frame = "flowchart TD\nA-->B\nclassDef k font-family:";
  return `${frame}${"x".repeat(length - frame.length - 1)}\n`;
}

describe("flowchartEditability", () => {
  it("accepts an ordinary diagram", () => {
    expect(check(f("A[Start] --> B{Ok?}\nB -->|yes| C"))).toEqual({
      editable: true,
    });
  });

  it.each([
    ["notFlowchart", 'pie\n  "A" : 1\n'],
    ["notFlowchart", ""],
    ["sourceTooLong", ofLength(FLOWCHART_MAX_SOURCE_LENGTH + 1)],
    [
      "structureIssue",
      '%%{init: {\n"theme": "dark"}}%%\nflowchart TD\nA-->B\n',
    ],
    ["structureIssue", "---\nnot yaml: [\n---\nflowchart TD\nA-->B\n"],
    ["structureIssue", "%%{ not json }%%\nflowchart TD\nA-->B\n"],
    ["loneCarriageReturn", "flowchart TD\rA-->B\r"],
    ["markupRewrite", f('%% <a href="x">\nA')],
    ["styleLikeText", f('A["style x:#a; y"]')],
    ["inlineDirective", f("A-->B %%{init: {}}%%")],
    ["unsupportedStatements", f("A:B")],
    ["tooManyEdges", edges(FLOWCHART_MAX_EDGES + 1)],
    ["duplicateEdgeId", f("A e1@--> B\nA e1@--> B")],
    ["duplicateEdgeId", f("A-->B\nA L_A_B_0@--> B")],
    ["nodeSubgraphIdConflict", f("subgraph S\nA\nend\nB --> S")],
    ["nodeEdgeIdConflict", f("e1\nA e1@--> B")],
    ["undrawableShape", f("A(-x-) --> B")],
  ])("%s", (reason, source) => {
    expect(reasonOf(source)).toBe(reason);
  });

  it("lists the opaque statements with their lines", () => {
    const result = check(f("A-->B\nC[x\nD:E"));
    expect(result).toMatchObject({
      editable: false,
      reason: "unsupportedStatements",
    });
    if (!result.editable) {
      expect(result.lines.map((line) => line.index)).toEqual([2, 3]);
      expect(result.detail).toContain("unterminatedBracket");
    }
  });

  it("draws the edge limit between 500 and 501", () => {
    expect(check(edges(FLOWCHART_MAX_EDGES))).toEqual({ editable: true });
    expect(reasonOf(edges(FLOWCHART_MAX_EDGES + 1))).toBe("tooManyEdges");
  });

  it("draws the length limit between 50000 and 50001", () => {
    expect(ofLength(FLOWCHART_MAX_SOURCE_LENGTH).length).toBe(50000);
    expect(check(ofLength(FLOWCHART_MAX_SOURCE_LENGTH))).toEqual({
      editable: true,
    });
    expect(reasonOf(ofLength(FLOWCHART_MAX_SOURCE_LENGTH + 1))).toBe(
      "sourceTooLong",
    );
  });

  it("refuses reserved ids", () => {
    expect(reasonOf(f("A-->end"))).toBe("unsupportedStatements");
    expect(reasonOf(f("default-->B"))).toBe("unsupportedStatements");
    expect(check(f("endA-->Aend"))).toEqual({ editable: true });
  });

  it("separates an inline directive from a pure directive line", () => {
    expect(
      check(
        '%%{init: {"flowchart": {"curve": "linear"}}}%%\nflowchart TD\nA-->B\n',
      ),
    ).toEqual({ editable: true });
    expect(reasonOf(f('A["x %%{init: {}}%% y"]'))).toBe("inlineDirective");
  });

  it("tells a harmless style semicolon from a harmful one", () => {
    expect(check(f("A\nstyle A fill:#f00;"))).toEqual({ editable: true });
    expect(check(f("A\nstyle A fill:#f00;   "))).toEqual({ editable: true });
    expect(reasonOf(f('A["style x:#a; y"]'))).toBe("styleLikeText");
    expect(reasonOf(f("style A fill:#f00; B"))).toBe("styleLikeText");
  });

  it("assessFlowchart has the shape of the editor registry", () => {
    expect(assessFlowchart(f("A-->B"))).toEqual({ editable: true });
    const refused = assessFlowchart(f("A-->B\nC[x"));
    expect(refused).toMatchObject({
      editable: false,
      reason: "unsupportedStatements",
    });
    if (!refused.editable) expect(refused.unsupported).toHaveLength(1);
    const whole = assessFlowchart("flowchart TD\rA\r");
    if (!whole.editable) expect(whole.unsupported).toEqual([]);
  });
});
