import { describe, expect, it } from "vitest";
import {
  type PreparedFlowchart,
  prepareFlowchart,
} from "./flowchart-operation-support";
import {
  reasonOfRefusal,
  refusalOf,
  runOperation,
} from "./flowchart-operation-test-support";
import { planPreparedFlowchartOperation } from "./flowchart-operations";

const f = (body: string) => `flowchart TD\n    ${body}\n`;

describe("edge operations, edge cases", () => {
  it("refuses a link length out of range", () => {
    expect(
      reasonOfRefusal(
        refusalOf(f("A --> B"), {
          kind: "setEdgeKind",
          target: { index: 0, id: "L_A_B_0" },
          link: { type: "arrow_point", stroke: "normal", length: 99 },
        }),
      ),
    ).toBe("invalidLinkLength");
  });

  it("refuses a label on an invisible link", () => {
    expect(
      reasonOfRefusal(
        refusalOf(f("A ~~~ B"), {
          kind: "setEdgeLabel",
          target: { index: 0, id: "L_A_B_0" },
          label: "x",
        }),
      ),
    ).toBe("invisibleLinkLabel");
  });

  it("removes a label written inside the link", () => {
    expect(
      runOperation(f("A -- yes --> B"), {
        kind: "setEdgeLabel",
        target: { index: 0, id: "L_A_B_0" },
        label: null,
      }),
    ).toBe(f("A --> B"));
  });
});

describe("plans for a reading they do not hold for", () => {
  function preparedOf(source: string): PreparedFlowchart {
    const prepared = prepareFlowchart(source);
    if (!prepared.ok) throw new Error(prepared.error.detail);
    return prepared.value;
  }

  // The meaning promises a node the text does not have.
  function withPhantom(source: string): PreparedFlowchart {
    const prepared = preparedOf(source);
    const [first] = prepared.meaning.nodes;
    if (first === undefined) throw new Error("no node");
    return {
      ...prepared,
      meaning: {
        ...prepared.meaning,
        nodes: [...prepared.meaning.nodes, { ...first, id: "Phantom" }],
      },
    };
  }

  it("refuses a plan whose result does not read back as promised", () => {
    const source = f("A --> B");
    const result = planPreparedFlowchartOperation(source, withPhantom(source), {
      kind: "setDirection",
      direction: "LR",
    });
    expect(!result.ok && reasonOfRefusal(result.error)).toBe("planUnverified");
  });

  it("refuses to reconnect when neither way of writing it holds", () => {
    const source = f("A --> B\n    C");
    const result = planPreparedFlowchartOperation(source, withPhantom(source), {
      kind: "reconnectEdge",
      target: { index: 0, id: "L_A_B_0" },
      end: "end",
      nodeId: "C",
    });
    expect(!result.ok && reasonOfRefusal(result.error)).toBe(
      "notPlainlyReconnectable",
    );
  });

  it("refuses to spell out an implicit node whose label cannot be written", () => {
    const source = f("A --> B");
    const prepared = preparedOf(source);
    const broken = {
      ...prepared,
      meaning: {
        ...prepared.meaning,
        nodes: prepared.meaning.nodes.map((node) =>
          node.id === "A" ? { ...node, text: "a\u0000b" } : node,
        ),
      },
    };
    const result = planPreparedFlowchartOperation(source, broken, {
      kind: "setNodeShape",
      nodeId: "A",
      shape: "round",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses to rewrite an inline label of a link it could not write", () => {
    const source = f("A -- yes --> B");
    const prepared = preparedOf(source);
    const broken = {
      ...prepared,
      meaning: {
        ...prepared.meaning,
        edges: prepared.meaning.edges.map((edge) => ({
          ...edge,
          stroke: "invisible" as const,
        })),
      },
    };
    const result = planPreparedFlowchartOperation(source, broken, {
      kind: "setEdgeLabel",
      target: { index: 0, id: "L_A_B_0" },
      label: null,
    });
    expect(result.ok).toBe(false);
  });
});
