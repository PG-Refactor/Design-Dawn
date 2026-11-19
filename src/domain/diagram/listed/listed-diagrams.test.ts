import { describe, expect, it } from "vitest";
import {
  type DiagramOperation,
  planDiagramOperation,
} from "../diagram-operation";
import { analyzeDiagramSource } from "../diagram-source";
import { applyTextEdits } from "../text-edit";
import { readClass } from "./class-diagram";
import { readEr } from "./er-diagram";
import { readState } from "./state-diagram";

// Plans the operation, applies its edits and runs its own verification, like the app does
// (minus the render check, which the real-Mermaid tests cover).
function apply(source: string, request: DiagramOperation): string {
  const plan = planDiagramOperation(source, request);
  if (!plan.ok) throw new Error(`refused: ${plan.error.detail}`);
  const applied = applyTextEdits(source, plan.value.edits);
  if (!applied.ok) throw new Error(applied.error.detail);
  const verified = plan.value.verify(applied.value.text);
  if (!verified.ok) throw new Error(`not verified: ${verified.error.kind}`);
  return applied.value.text;
}

function refusal(source: string, request: DiagramOperation): string | null {
  const plan = planDiagramOperation(source, request);
  return plan.ok ? null : plan.error.detail;
}

const ER = `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER {
        string id PK
        int total "in yen"
    }
    PRODUCT
`;

describe("ER diagrams", () => {
  it("reads entities, attributes and relationships", () => {
    const read = readEr(ER);
    expect(read.editable).toBe(true);
    expect(read.meaning.entities.map((entity) => entity.name)).toEqual([
      "CUSTOMER",
      "ORDER",
      "PRODUCT",
    ]);
    expect(read.meaning.entities[1]?.attributes).toEqual([
      { type: "string", name: "id", keys: ["PK"], comment: "" },
      { type: "int", name: "total", keys: [], comment: "in yen" },
    ]);
    expect(read.meaning.relationships[0]).toEqual({
      left: "CUSTOMER",
      leftCardinality: "||",
      identifying: true,
      rightCardinality: "o{",
      right: "ORDER",
      label: "places",
    });
    expect(analyzeDiagramSource(ER).editability).toEqual({
      editable: true,
      type: "er",
    });
  });

  it("is read-only with a line it does not understand", () => {
    const analysis = analyzeDiagramSource(
      `${ER}    CUSTOMER["Customer"] {\n    }\n`,
    );
    expect(analysis.editability.editable).toBe(false);
  });

  it("adds an attribute inside the block, turning a bare entity into a block", () => {
    const added = apply(ER, {
      diagram: "er",
      operation: {
        kind: "addAttribute",
        entity: "PRODUCT",
        attribute: { type: "string", name: "sku", keys: ["UK"], comment: "" },
      },
    });
    expect(added).toContain("    PRODUCT {\n        string sku UK\n    }\n");
    const appended = apply(ER, {
      diagram: "er",
      operation: {
        kind: "addAttribute",
        entity: "ORDER",
        attribute: { type: "date", name: "placed", keys: [], comment: "" },
      },
    });
    expect(appended).toContain(
      'int total "in yen"\n        date placed\n    }',
    );
  });

  it("turns a block back into a bare entity when its last attribute goes", () => {
    const one = apply(ER, {
      diagram: "er",
      operation: { kind: "deleteAttribute", entity: "ORDER", index: 1 },
    });
    const none = apply(one, {
      diagram: "er",
      operation: { kind: "deleteAttribute", entity: "ORDER", index: 0 },
    });
    expect(none).toBe(
      "erDiagram\n    CUSTOMER ||--o{ ORDER : places\n    ORDER\n    PRODUCT\n",
    );
  });

  it("adds and changes relationships, quoting labels with spaces", () => {
    const added = apply(ER, {
      diagram: "er",
      operation: {
        kind: "addRelationship",
        relationship: {
          left: "ORDER",
          leftCardinality: "||",
          identifying: false,
          rightCardinality: "|{",
          right: "LINE_ITEM",
          label: "is made of",
        },
      },
    });
    expect(added).toContain('ORDER ||..|{ LINE_ITEM : "is made of"');
    const removed = apply(added, {
      diagram: "er",
      operation: { kind: "deleteRelationship", index: 1 },
    });
    expect(
      readEr(removed).meaning.entities.map((entity) => entity.name),
    ).not.toContain("LINE_ITEM");
  });

  it("refuses to delete an entity a relationship uses, and bad names", () => {
    expect(
      refusal(ER, {
        diagram: "er",
        operation: { kind: "deleteEntity", name: "ORDER" },
      }),
    ).toContain("entityInUse");
    expect(
      refusal(ER, {
        diagram: "er",
        operation: { kind: "addEntity", name: "two words" },
      }),
    ).toContain("invalidName");
    expect(
      apply(ER, {
        diagram: "er",
        operation: { kind: "deleteEntity", name: "PRODUCT" },
      }),
    ).not.toContain("PRODUCT");
  });
});

const STATE = `stateDiagram-v2
    [*] --> Draft
    Draft --> Review : submit
    Review : under review
    Review --> [*]
`;

describe("state diagrams", () => {
  it("reads states, descriptions and transitions", () => {
    const read = readState(STATE);
    expect(read.editable).toBe(true);
    expect(read.meaning.states).toEqual([
      { id: "Draft", description: "" },
      { id: "Review", description: "under review" },
    ]);
    expect(read.meaning.transitions[1]).toEqual({
      from: "Draft",
      to: "Review",
      label: "submit",
    });
  });

  it("is read-only with a composite state or a note", () => {
    expect(readState(`${STATE}    state Group {\n    }\n`).editable).toBe(
      false,
    );
    expect(readState(`${STATE}    note right of Draft : x\n`).editable).toBe(
      false,
    );
  });

  it("describes a state on its own line, and adds transitions", () => {
    const described = apply(STATE, {
      diagram: "state",
      operation: {
        kind: "updateState",
        state: { id: "Draft", description: "being written" },
      },
    });
    expect(described).toContain("    Draft : being written\n");
    const added = apply(described, {
      diagram: "state",
      operation: {
        kind: "addTransition",
        transition: { from: "Review", to: "Draft", label: "rework" },
      },
    });
    expect(added).toContain("    Review --> Draft : rework\n");
  });

  it("adds a state without a description as its bare id, which Mermaid draws", () => {
    // `state Paused` alone is not drawn by Mermaid; a line with the id is.
    const added = apply(STATE, {
      diagram: "state",
      operation: { kind: "addState", state: { id: "Paused", description: "" } },
    });
    expect(added).toContain("\n    Paused\n");
    expect(added).not.toContain("state Paused");
    const read = readState(added);
    expect(read.editable).toBe(true);
    expect(read.meaning.states.map((state) => state.id)).toContain("Paused");
    // The `state X` form written by hand is still read.
    expect(
      readState(`${STATE}    state Waiting\n`).meaning.states.map(
        (state) => state.id,
      ),
    ).toContain("Waiting");
  });

  it("refuses to delete a state a transition uses", () => {
    expect(
      refusal(STATE, {
        diagram: "state",
        operation: { kind: "deleteState", id: "Review" },
      }),
    ).toContain("stateInUse");
  });
});

const CLASS = `classDiagram
    class Order {
        +UUID id
        +place()
    }
    Customer : +String name
    Customer "1" --> "*" Order
`;

const SIMPLE_CLASS = `classDiagram
    class Order {
        +UUID id
    }
    Customer : +String name
    Customer --> Order : places
`;

describe("class diagrams", () => {
  it("reads classes, members (in and outside blocks) and relationships", () => {
    const read = readClass(SIMPLE_CLASS);
    expect(read.editable).toBe(true);
    expect(read.meaning.classes).toEqual([
      { name: "Order", members: ["+UUID id"] },
      { name: "Customer", members: ["+String name"] },
    ]);
    expect(read.meaning.relationships).toEqual([
      {
        from: "Customer",
        fromCardinality: "",
        arrow: "-->",
        toCardinality: "",
        to: "Order",
        label: "places",
      },
    ]);
  });

  it("reads cardinalities, and is read-only with generics", () => {
    expect(readClass(CLASS).meaning.relationships[0]).toMatchObject({
      fromCardinality: "1",
      toCardinality: "*",
    });
    expect(readClass(`${CLASS}    class Box~T~\n`).editable).toBe(false);
  });

  it("adds members inside a block, or outside when there is none", () => {
    const inBlock = apply(SIMPLE_CLASS, {
      diagram: "class",
      operation: { kind: "addMember", className: "Order", member: "+place()" },
    });
    expect(inBlock).toContain("+UUID id\n        +place()\n    }");
    const outside = apply(SIMPLE_CLASS, {
      diagram: "class",
      operation: {
        kind: "addMember",
        className: "Customer",
        member: "+login()",
      },
    });
    expect(outside).toContain("    Customer : +login()\n");
  });

  it("changes a relationship's arrow and refuses braces in a member", () => {
    const changed = apply(SIMPLE_CLASS, {
      diagram: "class",
      operation: {
        kind: "updateRelationship",
        index: 0,
        relationship: {
          from: "Customer",
          fromCardinality: "1",
          arrow: "o--",
          toCardinality: "0..*",
          to: "Order",
          label: "",
        },
      },
    });
    expect(changed).toContain('    Customer "1" o-- "0..*" Order\n');
    expect(
      refusal(SIMPLE_CLASS, {
        diagram: "class",
        operation: { kind: "addMember", className: "Order", member: "x {" },
      }),
    ).toContain("invalidText");
  });
});
