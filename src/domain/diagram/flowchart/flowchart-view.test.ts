import { describe, expect, it } from "vitest";
import { planFlowchartOperation } from "./flowchart-operations";
import { readFlowchartView } from "./flowchart-view";

const SOURCE = [
  "flowchart TD",
  '  A["Start<br/>here"] --> B(End)',
  '  B -.->|"a #lt;b#gt;"| C',
  "  C --> D & E",
  '  F["one"]',
  '  F["two"]',
  '  G["`md`"]',
  "  subgraph S1 [Group]",
  "    H",
  "  end",
  "",
].join("\n");

describe("readFlowchartView", () => {
  it("returns null for a source that is not an editable flowchart", () => {
    expect(readFlowchartView("flowchart LR\n  ???\n")).toBeNull();
    expect(readFlowchartView('pie\n  "A" : 1\n')).toBeNull();
  });

  it("lists nodes, edges and subgraphs with decoded text", () => {
    const view = readFlowchartView(SOURCE);
    expect(view?.direction).toBe("TB");
    expect(view?.nodes.map((node) => [node.id, node.displayLabel])).toEqual([
      ["A", "Start\nhere"],
      ["B", "End"],
      ["C", "C"],
      ["D", "D"],
      ["E", "E"],
      ["F", "two"],
      ["G", "md"],
      ["H", "H"],
    ]);
    expect(view?.edges.map((edge) => [edge.id, edge.displayLabel])).toEqual([
      ["L_A_B_0", ""],
      ["L_B_C_0", "a <b>"],
      ["L_C_D_0", ""],
      ["L_C_E_0", ""],
    ]);
    expect(view?.subgraphs).toEqual([
      { id: "S1", title: "Group", memberLabels: ["H"] },
    ]);
  });

  it("marks the same restrictions the operations refuse with", () => {
    const view = readFlowchartView(SOURCE);
    if (view === null) throw new Error("expected a view");
    for (const node of view.nodes) {
      const plan = planFlowchartOperation(SOURCE, {
        kind: "setNodeLabel",
        nodeId: node.id,
        label: "changed",
      });
      const refusedWith = plan.ok ? null : plan.error.detail.split(":")[0];
      expect(node.restriction, node.id).toBe(refusedWith ?? null);
    }
    expect(view.nodes.find((node) => node.id === "F")?.restriction).toBe(
      "multipleDefinitions",
    );
    for (const edge of view.edges) {
      const plan = planFlowchartOperation(SOURCE, {
        kind: "setEdgeLabel",
        target: { index: edge.index, id: edge.id },
        label: "changed",
      });
      const refusedWith = plan.ok ? null : plan.error.detail.split(":")[0];
      expect(edge.restriction ?? edge.labelRestriction, edge.id).toBe(
        refusedWith ?? null,
      );
    }
    expect(view.edges.map((edge) => edge.restriction)).toEqual([
      null,
      null,
      "sharedLink",
      "sharedLink",
    ]);
  });

  it("allows reconnecting only the outer ends of a chain", () => {
    const view = readFlowchartView("flowchart LR\n  A --> B --> C\n");
    expect(
      view?.edges.map((edge) => [edge.canReconnectStart, edge.canReconnectEnd]),
    ).toEqual([
      [true, false],
      [false, true],
    ]);
  });
});
