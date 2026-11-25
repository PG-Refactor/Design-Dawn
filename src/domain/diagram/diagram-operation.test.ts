import { describe, expect, it } from "vitest";
import {
  type DiagramOperation,
  planDiagramOperation,
} from "./diagram-operation";
import { applyTextEdits } from "./text-edit";

// Each type: a source, an operation it plans, and one it refuses.
const CASES: readonly [string, string, DiagramOperation, DiagramOperation][] = [
  [
    "pie",
    'pie\n    "A" : 1\n',
    { diagram: "pie", operation: { kind: "setTitle", title: "T" } },
    {
      diagram: "pie",
      operation: { kind: "deleteSlice", target: { index: 9, label: "Z" } },
    },
  ],
  [
    "flowchart",
    "flowchart TD\n    A --> B\n",
    {
      diagram: "flowchart",
      operation: { kind: "setDirection", direction: "LR" },
    },
    { diagram: "flowchart", operation: { kind: "deleteNode", nodeId: "Z" } },
  ],
  [
    "gantt",
    "gantt\n    dateFormat YYYY-MM-DD\n    A :a, 2026-01-01, 1d\n",
    { diagram: "gantt", operation: { kind: "setTitle", title: "T" } },
    {
      diagram: "gantt",
      operation: { kind: "deleteTask", target: { index: 9, name: "Z" } },
    },
  ],
  [
    "sequence",
    "sequenceDiagram\n    A->>B: hi\n",
    {
      diagram: "sequence",
      operation: { kind: "setAutonumber", enabled: true },
    },
    {
      diagram: "sequence",
      operation: {
        kind: "deleteMessage",
        target: { index: 9, fingerprint: "" },
      },
    },
  ],
  [
    "er",
    "erDiagram\n    A\n",
    { diagram: "er", operation: { kind: "addEntity", name: "B" } },
    { diagram: "er", operation: { kind: "deleteEntity", name: "Z" } },
  ],
  [
    "state",
    "stateDiagram-v2\n    A\n",
    {
      diagram: "state",
      operation: { kind: "addState", state: { id: "B", description: "" } },
    },
    { diagram: "state", operation: { kind: "deleteState", id: "Z" } },
  ],
  [
    "class",
    "classDiagram\n    class A\n",
    { diagram: "class", operation: { kind: "addClass", name: "B" } },
    { diagram: "class", operation: { kind: "deleteClass", name: "Z" } },
  ],
];

describe("planning a diagram operation", () => {
  it.each(CASES)(
    "plans and verifies a %s operation, and refuses another",
    (_type, source, planned, refused) => {
      const plan = planDiagramOperation(source, planned);
      if (!plan.ok) throw new Error(plan.error.detail);
      const applied = applyTextEdits(source, plan.value.edits);
      if (!applied.ok) throw new Error(applied.error.detail);
      expect(plan.value.verify(applied.value.text).ok).toBe(true);
      expect(plan.value.verify(source).ok).toBe(false);
      expect(planDiagramOperation(source, refused).ok).toBe(false);
    },
  );
});
