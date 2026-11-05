// @vitest-environment jsdom
// A node's attribute block right before an edge id (`A@{ shape: cyl } e1@--> B`), which
// mermaid accepts since 12.3.0: every GUI operation on such a line must give a text the
// real mermaid accepts, draws, and reads with exactly the meaning the operation promised.
import { beforeAll, describe, expect, it } from "vitest";
import {
  type FlowchartOperation,
  planFlowchartOperation,
  verifyFlowchartCandidate,
} from "../../domain/diagram/flowchart/flowchart-operations";
import { readFlowchartView } from "../../domain/diagram/flowchart/flowchart-view";
import { applyTextEdits } from "../../domain/diagram/text-edit";
import {
  mermaidAgrees,
  renderCheck,
  TEST_TIMEOUT_MS,
} from "./test-support/flowchart-operation-harness";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";

beforeAll(installFakeSvgMeasurement);

const SOURCE = `flowchart TD
    A@{ shape: cyl, label: "Store" } e1@--> B@{ shape: diam } e2@-.->|retry| C
    B --> D
`;

const e1 = { index: 0, id: "e1" };
const e2 = { index: 1, id: "e2" };

const OPERATIONS: readonly (readonly [string, FlowchartOperation])[] = [
  [
    "label the edge with the id",
    { kind: "setEdgeLabel", target: e1, label: "save" },
  ],
  [
    "remove the label of the second edge",
    { kind: "setEdgeLabel", target: e2, label: null },
  ],
  [
    "change the kind of the edge",
    {
      kind: "setEdgeKind",
      target: e1,
      link: { type: "arrow_circle", stroke: "thick" },
    },
  ],
  [
    "reconnect its end",
    { kind: "reconnectEdge", target: e2, end: "end", nodeId: "D" },
  ],
  ["delete the edge with the id", { kind: "deleteEdge", target: e1 }],
  ["delete the node in the middle", { kind: "deleteNode", nodeId: "B" }],
  [
    "add an edge from the node with the block",
    { kind: "addEdge", from: "A", to: "D" },
  ],
];

// The label and shape of a node written with @{ ... } are not rewritten by the editor (the
// same for every such node, with or without an edge id after it).
const REFUSED: readonly (readonly [string, FlowchartOperation])[] = [
  [
    "rename the node with the block",
    { kind: "setNodeLabel", nodeId: "A", label: "Database" },
  ],
  ["change its shape", { kind: "setNodeShape", nodeId: "A", shape: "circle" }],
];

describe("node blocks before edge ids", () => {
  it("are read by the GUI with their ids", () => {
    const view = readFlowchartView(SOURCE);
    expect(view?.edges.map((edge) => edge.id)).toEqual(["e1", "e2", "L_B_D_0"]);
    expect(view?.nodes.find((node) => node.id === "A")?.displayLabel).toBe(
      "Store",
    );
  });

  it.each(OPERATIONS)(
    "%s",
    async (_name, operation) => {
      const plan = planFlowchartOperation(SOURCE, operation);
      if (!plan.ok) throw new Error(`refused: ${plan.error.detail}`);
      const applied = applyTextEdits(SOURCE, plan.value.edits);
      if (!applied.ok) throw new Error(applied.error.detail);
      expect(
        verifyFlowchartCandidate(applied.value.text, plan.value.expected),
      ).toEqual({ ok: true, value: undefined });
      const agreement = await mermaidAgrees(
        applied.value.text,
        plan.value.expected,
      );
      expect(agreement.detail).toBe("");
      expect(agreement.agrees).toBe(true);
      expect((await renderCheck(applied.value.text)).ok).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it.each(REFUSED)("does not %s", (_name, operation) => {
    const plan = planFlowchartOperation(SOURCE, operation);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error.detail.split(":")[0]).toBe("atBlockNode");
  });
});
