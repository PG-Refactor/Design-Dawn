import { describe, expect, it } from "vitest";
import { planFlowchartOperation } from "./flowchart-operations";
import { readFlowchartNodeActions, readFlowchartView } from "./flowchart-view";

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
      {
        id: "S1",
        title: "Group",
        memberLabels: ["H"],
        direction: null,
        dissolveRestriction: null,
      },
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

const TIER_TWO = [
  "flowchart TD",
  "  A --> B",
  "  subgraph One",
  "    direction LR",
  "    C",
  "    D --> E",
  "  end",
  "  subgraph Two",
  "    D",
  "  end",
  "  class One hot",
  "",
].join("\n");

describe("subgraphs and node actions of the view", () => {
  it("shows the direction, the owner and why a block cannot be dissolved", () => {
    const view = readFlowchartView(TIER_TWO);
    expect(
      view?.subgraphs.map((subgraph) => [
        subgraph.id,
        subgraph.direction,
        subgraph.dissolveRestriction,
      ]),
    ).toEqual([
      ["One", "LR", "subgraphReferenced"],
      ["Two", null, null],
    ]);
    expect(view?.nodes.map((node) => [node.id, node.ownerId])).toEqual([
      ["A", null],
      ["B", null],
      ["C", "One"],
      ["D", "One"],
      ["E", "One"],
    ]);
  });

  it("gives, for a node, the reason each action would be refused with", () => {
    expect(readFlowchartNodeActions(TIER_TWO, "A")).toEqual({
      ownerId: null,
      edgeCount: 1,
      deleteRestriction: null,
      moveRestrictions: { One: null, Two: null },
      removeRestriction: null,
    });
    expect(readFlowchartNodeActions(TIER_TWO, "D")).toEqual({
      ownerId: "One",
      edgeCount: 1,
      deleteRestriction: null,
      moveRestrictions: { One: null, Two: "firstDefinitionWins" },
      removeRestriction: "mentionedInStatement",
    });
    expect(readFlowchartNodeActions(TIER_TWO, "C")?.removeRestriction).toBe(
      null,
    );
  });

  it("agrees with the operations: the reason is the one the plan gives", () => {
    for (const nodeId of ["A", "B", "C", "D", "E"]) {
      const actions = readFlowchartNodeActions(TIER_TWO, nodeId);
      for (const [subgraphId, restriction] of Object.entries(
        actions?.moveRestrictions ?? {},
      )) {
        const plan = planFlowchartOperation(TIER_TWO, {
          kind: "moveNodeToSubgraph",
          nodeId,
          subgraphId,
        });
        expect(restriction, `${nodeId} -> ${subgraphId}`).toBe(
          plan.ok ? null : plan.error.detail.split(":")[0],
        );
      }
    }
  });

  it("returns null for an unknown node and for a source that cannot be edited", () => {
    expect(readFlowchartNodeActions(TIER_TWO, "Nope")).toBeNull();
    expect(readFlowchartNodeActions("flowchart LR\n  ???\n", "A")).toBeNull();
  });
});
