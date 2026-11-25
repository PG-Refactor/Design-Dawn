import { describe, expect, it } from "vitest";
import { planEdgeDeletion } from "./flowchart-edge-delete-plan";
import { flowchartEditability } from "./flowchart-editability";
import { prepareFlowchart, resolveEdge } from "./flowchart-operation-support";
import { reasonOfRefusal, refusalOf } from "./flowchart-operation-test-support";
import { readFlowchart } from "./flowchart-reader";
import { readFlowchartView } from "./flowchart-view";

const reasonOf = (source: string) => {
  const editability = flowchartEditability(readFlowchart(source));
  return editability.editable ? null : editability.reason;
};

describe("headers", () => {
  it("is not a flowchart when the header line starts with a separator", () => {
    expect(readFlowchart(";flowchart TD\nA").isFlowchart).toBe(false);
  });
});

describe("front matter", () => {
  const withFrontMatter = (body: string) =>
    `---\n${body}\n---\nflowchart TD\n    A\n`;

  it("reads nested keys and blank lines", () => {
    expect(
      reasonOf(
        withFrontMatter("title: T\n\nconfig:\n  theme: dark\n  look: classic"),
      ),
    ).toBeNull();
  });

  it.each([
    ["a line that is not a key", "- item"],
    ["an odd indentation", "config:\n   theme: dark"],
    ["a deeper key under a key with a value", "title: T\n  sub: x"],
    ["a level skipped", "config:\n    theme: dark"],
    ["a key given twice", "title: A\ntitle: B"],
  ])("does not read %s", (_what, body) => {
    expect(reasonOf(withFrontMatter(body))).toBe("structureIssue");
  });
});

describe("directives", () => {
  it("does not read a directive whose settings are not JSON", () => {
    expect(reasonOf("%%{init: {theme: dark}}%%\nflowchart TD\n    A\n")).toBe(
      "structureIssue",
    );
  });
});

describe("labels", () => {
  it("refuses a label Mermaid would read as a style definition", () => {
    expect(
      reasonOfRefusal(
        refusalOf("flowchart TD\n    A\n", {
          kind: "setNodeLabel",
          nodeId: "A",
          label: "style a:#-;",
        }),
      ),
    ).toBe("styleLikeText");
  });
});

describe("the view and edge deletion", () => {
  it("marks an edge with a markdown label as not relabelable", () => {
    const view = readFlowchartView('flowchart TD\n    A -->|"`**md**`"| B\n');
    expect(view?.edges[0]?.labelRestriction).toBe("markdownLabel");
  });

  it("refuses to delete an edge when no way of writing it holds", () => {
    const source = "flowchart TD\n    A --> B\n";
    const prepared = prepareFlowchart(source);
    if (!prepared.ok) throw new Error("unreadable");
    const [first] = prepared.value.meaning.nodes;
    if (first === undefined) throw new Error("no node");
    const phantom = {
      ...prepared.value,
      meaning: {
        ...prepared.value.meaning,
        nodes: [...prepared.value.meaning.nodes, { ...first, id: "Z" }],
      },
    };
    const edge = resolveEdge(phantom, { index: 0, id: "L_A_B_0" });
    if (!edge.ok) throw new Error("no edge");
    const result = planEdgeDeletion(source, phantom, edge.value);
    expect(!result.ok && reasonOfRefusal(result.error)).toBe(
      "notPlainlyDeletable",
    );
  });
});
