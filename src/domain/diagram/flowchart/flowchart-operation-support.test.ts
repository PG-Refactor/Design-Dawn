import { describe, expect, it } from "vitest";
import { flowchartEditability } from "./flowchart-editability";
import {
  candidateOf,
  confirmEdits,
  prepareFlowchart,
} from "./flowchart-operation-support";
import { refusalOf } from "./flowchart-operation-test-support";
import { readFlowchart } from "./flowchart-reader";
import { subgraphModelOf } from "./flowchart-subgraph-model";

const SOURCE = "flowchart TD\n    A --> B\n";

function meaningOf(source: string) {
  const prepared = prepareFlowchart(source);
  if (!prepared.ok) throw new Error(prepared.error.detail);
  return prepared.value.meaning;
}

describe("finding an edge", () => {
  it("refuses an index that is not a whole number", () => {
    expect(
      refusalOf(SOURCE, {
        kind: "deleteEdge",
        target: { index: 0.5, id: "L_A_B_0" },
      }).detail,
    ).toContain("targetNotFound");
  });
});

describe("proving a plan", () => {
  it("refuses edits that cannot be applied", () => {
    const result = candidateOf(
      SOURCE,
      [
        { start: 0, end: 5, text: "" },
        { start: 2, end: 6, text: "" },
      ],
      meaningOf(SOURCE),
    );
    expect(result.ok).toBe(false);
  });

  it("confirms a plan without edits at once", () => {
    expect(confirmEdits(SOURCE, [], meaningOf(SOURCE)).ok).toBe(true);
  });
});

describe("edge attributes inside a subgraph", () => {
  it("count as a mention of the block, as Mermaid lists them", () => {
    const source =
      "flowchart TD\n    A e1@--> B\n    subgraph S\n        e1@{ curve: basis }\n    end\n";
    const reading = readFlowchart(source);
    const meaning = meaningOf(source);
    const model = subgraphModelOf(reading, meaning);
    expect(model.ok && model.value.members.get("S")).toEqual(["e1"]);
  });
});

describe("mentions", () => {
  it("names the edge attribute line when a node and an edge share an id", () => {
    const reading = readFlowchart(
      "flowchart TD\n    e1\n    A e1@--> B\n    e1@{ curve: basis }\n",
    );
    const editability = flowchartEditability(reading);
    expect(editability.editable).toBe(false);
    if (editability.editable) return;
    expect(editability.reason).toBe("nodeEdgeIdConflict");
    expect(editability.lines.map((line) => line.index)).toContain(3);
  });
});
