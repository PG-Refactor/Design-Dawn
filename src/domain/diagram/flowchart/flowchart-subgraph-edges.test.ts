import { describe, expect, it } from "vitest";
import type { PreparedFlowchart } from "./flowchart-operation-support";
import {
  reasonOfRefusal,
  refusalOf,
  runOperation,
} from "./flowchart-operation-test-support";
import { readFlowchart } from "./flowchart-reader";
import {
  planCreateSubgraph,
  planDissolveSubgraph,
  planMoveNodeToSubgraph,
  planRemoveNodeFromSubgraph,
  planSetSubgraphDirection,
  planSetSubgraphTitle,
} from "./flowchart-subgraph-operations";

const SOURCE = "flowchart TD\n    A\n    subgraph S\n        B\n    end\n";

function prepared(source: string): PreparedFlowchart {
  const reading = readFlowchart(source);
  if (reading.meaning === null) throw new Error("unreadable");
  return { reading, meaning: reading.meaning };
}

describe("when the block model and the reading disagree", () => {
  // A meaning whose subgraph has other members than its block shows.
  const disagreeing = (() => {
    const base = prepared(SOURCE);
    return {
      ...base,
      meaning: {
        ...base.meaning,
        subgraphs: base.meaning.subgraphs.map((subgraph) => ({
          ...subgraph,
          members: ["A"],
        })),
      },
    };
  })();

  it.each([
    ["the title", () => planSetSubgraphTitle(SOURCE, disagreeing, "S", "T")],
    [
      "the direction",
      () => planSetSubgraphDirection(SOURCE, disagreeing, "S", "LR"),
    ],
    [
      "a new block",
      () => planCreateSubgraph(SOURCE, disagreeing, { title: "T" }),
    ],
    ["dissolving", () => planDissolveSubgraph(SOURCE, disagreeing, "S")],
    [
      "moving a node in",
      () => planMoveNodeToSubgraph(SOURCE, disagreeing, "A", "S"),
    ],
    [
      "taking a node out",
      () => planRemoveNodeFromSubgraph(SOURCE, disagreeing, "B", "S"),
    ],
  ])("refuses to plan %s", (_what, plan) => {
    const result = plan();
    expect(!result.ok && reasonOfRefusal(result.error)).toBe(
      "subgraphModelMismatch",
    );
  });

  it("refuses a plan whose result would not read back as promised", () => {
    const base = prepared(SOURCE);
    // A node the text does not have: the edited text cannot mean this.
    const promising = {
      ...base,
      meaning: {
        ...base.meaning,
        nodes: [...base.meaning.nodes, { ...base.meaning.nodes[0], id: "Z" }],
      },
    } as PreparedFlowchart;
    const result = planSetSubgraphTitle(SOURCE, promising, "S", "T");
    expect(!result.ok && reasonOfRefusal(result.error)).toBe("planUnverified");
  });
});

describe("titles and directions", () => {
  it("does not rewrite a markdown title", () => {
    const source =
      'flowchart TD\n    subgraph S ["`**md**`"]\n        A\n    end\n';
    expect(
      reasonOfRefusal(
        refusalOf(source, {
          kind: "setSubgraphTitle",
          subgraphId: "S",
          title: "x",
        }),
      ),
    ).toBe("markdownLabel");
  });

  it("indents a direction in an empty block one level in, with the default indent at the top level", () => {
    const source = "flowchart TD\nsubgraph S\nend\n";
    expect(
      runOperation(source, {
        kind: "setSubgraphDirection",
        subgraphId: "S",
        direction: "LR",
      }),
    ).toBe("flowchart TD\nsubgraph S\n    direction LR\nend\n");
  });
});

describe("dissolving", () => {
  it("dissolves an empty block, and one written without indentation", () => {
    expect(
      runOperation("flowchart TD\nA\nsubgraph S\nend\n", {
        kind: "dissolveSubgraph",
        subgraphId: "S",
      }),
    ).toBe("flowchart TD\nA\n");
    expect(
      runOperation("flowchart TD\nsubgraph S\nA\nend\n", {
        kind: "dissolveSubgraph",
        subgraphId: "S",
      }),
    ).toBe("flowchart TD\nA\n");
  });
});

describe("taking a node out", () => {
  it("refuses a node the block does not write", () => {
    const source = "flowchart TD\n    A\n    subgraph S\n        B\n    end\n";
    expect(
      reasonOfRefusal(
        refusalOf(source, {
          kind: "removeNodeFromSubgraph",
          nodeId: "A",
          subgraphId: "S",
        }),
      ),
    ).toBe("notAMember");
  });

  it("keeps a node a style statement names after the block", () => {
    const source =
      "flowchart TD\n    subgraph S\n        B\n    end\n    style B fill:#fff\n";
    const result = runOperation(source, {
      kind: "removeNodeFromSubgraph",
      nodeId: "B",
      subgraphId: "S",
    });
    expect(readFlowchart(result).meaning?.subgraphs[0]?.members).toEqual([]);
  });
});

describe("moving and taking out, edge cases", () => {
  const BLOCK = "flowchart TD\n    subgraph S\n        X\n    end\n    A & B\n";

  it("refuses an unknown node or block when taking a node out", () => {
    for (const [nodeId, subgraphId] of [
      ["Nope", "S"],
      ["X", "Nope"],
    ] as const) {
      expect(
        refusalOf(BLOCK, { kind: "removeNodeFromSubgraph", nodeId, subgraphId })
          .detail,
      ).toContain("targetNotFound");
    }
  });

  it("moves a node first written further down, together with another", () => {
    const result = runOperation(BLOCK, {
      kind: "moveNodeToSubgraph",
      nodeId: "A",
      subgraphId: "S",
    });
    expect(readFlowchart(result).meaning?.subgraphs[0]?.members).toContain("A");
  });

  it("takes a node out that a statement written with another keeps alive", () => {
    const source =
      "flowchart TD\n    subgraph S\n        A\n    end\n    A & B\n";
    const result = runOperation(source, {
      kind: "removeNodeFromSubgraph",
      nodeId: "A",
      subgraphId: "S",
    });
    expect(readFlowchart(result).meaning?.subgraphs[0]?.members).toEqual([]);
  });

  it("takes several statements of one line out together", () => {
    const source = "flowchart TD\n    subgraph S\n        A; A; B\n    end\n";
    const result = runOperation(source, {
      kind: "removeNodeFromSubgraph",
      nodeId: "A",
      subgraphId: "S",
    });
    expect(result).toContain("        B\n");
  });
});

describe("deleting a node", () => {
  it.each([
    ["the middle of a chain", "flowchart TD\n    A --> B --> C\n", "B"],
    [
      "several entries of a list",
      "flowchart TD\n    A & B & C --> D\n    B --> A\n",
      "A",
    ],
    ["the end of a list", "flowchart TD\n    A & B --> C\n", "B"],
  ])("deletes it from %s", (_what, source, nodeId) => {
    const result = runOperation(source, { kind: "deleteNode", nodeId });
    expect(
      readFlowchart(result).meaning?.nodes.map((node) => node.id),
    ).not.toContain(nodeId);
  });
});
