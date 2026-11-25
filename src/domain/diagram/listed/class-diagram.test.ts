import { describe, expect, it } from "vitest";
import { applyTextEdits } from "../text-edit";
import {
  CLASS_EDITOR,
  type ClassOperation,
  type ClassRelationship,
  classRelationshipText,
  planClassOperation,
  readClass,
  verifyClassCandidate,
} from "./class-diagram";

const SOURCE = `classDiagram
    direction LR
    class Order {
        +UUID id
    }
    class Empty {
    }
    class Bare
    Customer : +String name
    Customer --> Order : places
`;

// Plans, applies and verifies an operation, the way the app does.
function apply(source: string, operation: ClassOperation): string {
  const plan = planClassOperation(source, operation);
  if (!plan.ok) throw new Error(`refused: ${plan.error.detail}`);
  const applied = applyTextEdits(source, plan.value.edits);
  if (!applied.ok) throw new Error(applied.error.detail);
  const verified = verifyClassCandidate(
    applied.value.text,
    plan.value.expected,
  );
  if (!verified.ok) throw new Error(`not verified: ${verified.error.kind}`);
  return applied.value.text;
}

function refusal(source: string, operation: ClassOperation): string {
  const plan = planClassOperation(source, operation);
  return plan.ok ? "" : plan.error.detail;
}

const RELATIONSHIP: ClassRelationship = {
  from: "Order",
  fromCardinality: "",
  arrow: "*--",
  toCardinality: "",
  to: "Line",
  label: "",
};

describe("reading a class diagram", () => {
  it("reads classes in the order they are named, with their members", () => {
    const read = readClass(SOURCE);
    expect(read.editable).toBe(true);
    expect(read.notReadable).toBeNull();
    expect(read.meaning.classes).toEqual([
      { name: "Order", members: ["+UUID id"] },
      { name: "Empty", members: [] },
      { name: "Bare", members: [] },
      { name: "Customer", members: ["+String name"] },
    ]);
  });

  it("is not editable without the classDiagram header", () => {
    const read = readClass("flowchart LR\n    A --> B\n");
    expect(read.editable).toBe(false);
    expect(read.notReadable?.reason).toBe("unsupportedLines");
  });

  it("is not editable with front matter (a structure the editor does not rewrite)", () => {
    const read = readClass("---\ntitle: T\n---\nclassDiagram\n    class A\n");
    expect(read.notReadable?.reason).toBe("structureIssue");
  });

  it.each([
    ["a brace inside a block", "    class A {\n        x {\n    }\n"],
    ["a class declared twice", "    class A\n    class A {\n    }\n"],
    ["a bare class declared twice", "    class A\n    class A\n"],
    ["a block that is never closed", "    class A {\n        +x\n"],
    ["a member outside a block with a brace", "    A : x {\n"],
    ["a line it does not know", '    note for A "text"\n'],
  ])("is not editable with %s, and names the line", (_what, body) => {
    const read = readClass(`classDiagram\n${body}`);
    expect(read.editable).toBe(false);
    expect(read.notReadable?.lines.length).toBeGreaterThan(0);
  });
});

describe("relationship text", () => {
  it("writes cardinalities and a label only when there are some", () => {
    expect(classRelationshipText(RELATIONSHIP)).toBe("Order *-- Line");
    expect(
      classRelationshipText({
        ...RELATIONSHIP,
        fromCardinality: "1",
        toCardinality: "*",
        label: "has",
      }),
    ).toBe('Order "1" *-- "*" Line : has');
  });
});

describe("class operations", () => {
  it("refuses everything on a diagram it cannot edit", () => {
    expect(
      refusal("classDiagram\n    class A {\n", { kind: "addClass", name: "B" }),
    ).toContain("notEditable");
  });

  it("adds a class, refusing a bad or taken name", () => {
    expect(apply(SOURCE, { kind: "addClass", name: "Line" })).toContain(
      "    class Line\n",
    );
    expect(refusal(SOURCE, { kind: "addClass", name: "1x" })).toContain(
      "invalidName",
    );
    expect(refusal(SOURCE, { kind: "addClass", name: "Order" })).toContain(
      "duplicateName",
    );
  });

  it("deletes a class with all its lines, unless a relationship uses it", () => {
    const withoutEmpty = apply(SOURCE, { kind: "deleteClass", name: "Empty" });
    expect(withoutEmpty).not.toContain("Empty");
    const withoutBare = apply(SOURCE, { kind: "deleteClass", name: "Bare" });
    expect(withoutBare).not.toContain("class Bare");
    expect(refusal(SOURCE, { kind: "deleteClass", name: "Order" })).toContain(
      "classInUse",
    );
    expect(refusal(SOURCE, { kind: "deleteClass", name: "Nope" })).toContain(
      "unknownClass",
    );
  });

  it("adds a member: after the last one in a block, into an empty block, or outside", () => {
    expect(
      apply(SOURCE, { kind: "addMember", className: "Order", member: "+n()" }),
    ).toContain("        +UUID id\n        +n()\n    }");
    expect(
      apply(SOURCE, { kind: "addMember", className: "Empty", member: "+x" }),
    ).toContain("    class Empty {\n        +x\n    }");
    expect(
      apply(SOURCE, { kind: "addMember", className: "Bare", member: "+y" }),
    ).toContain("    Bare : +y\n");
  });

  it("refuses a member for an unknown class, with a brace or empty", () => {
    expect(
      refusal(SOURCE, { kind: "addMember", className: "Nope", member: "+x" }),
    ).toContain("unknownClass");
    expect(
      refusal(SOURCE, { kind: "addMember", className: "Order", member: "{" }),
    ).toContain("invalidText");
    expect(
      refusal(SOURCE, { kind: "addMember", className: "Order", member: "  " }),
    ).toContain("emptyText");
  });

  it("changes a member where it is written, inside or outside a block", () => {
    expect(
      apply(SOURCE, {
        kind: "updateMember",
        className: "Order",
        index: 0,
        member: "-UUID id",
      }),
    ).toContain("        -UUID id\n");
    expect(
      apply(SOURCE, {
        kind: "updateMember",
        className: "Customer",
        index: 0,
        member: "+String full",
      }),
    ).toContain("    Customer : +String full\n");
    expect(
      refusal(SOURCE, {
        kind: "updateMember",
        className: "Order",
        index: 5,
        member: "+x",
      }),
    ).toContain("unknownMember");
    expect(
      refusal(SOURCE, {
        kind: "updateMember",
        className: "Nope",
        index: 0,
        member: "+x",
      }),
    ).toContain("unknownMember");
    expect(
      refusal(SOURCE, {
        kind: "updateMember",
        className: "Order",
        index: 0,
        member: "}",
      }),
    ).toContain("invalidText");
  });

  it("deletes a member, refusing one that is not there", () => {
    expect(
      apply(SOURCE, { kind: "deleteMember", className: "Customer", index: 0 }),
    ).not.toContain("+String name");
    expect(
      refusal(SOURCE, { kind: "deleteMember", className: "Order", index: 3 }),
    ).toContain("unknownMember");
    expect(
      refusal(SOURCE, { kind: "deleteMember", className: "Nope", index: 0 }),
    ).toContain("unknownMember");
  });

  it("adds a relationship, naming a new class by it", () => {
    const added = apply(SOURCE, {
      kind: "addRelationship",
      relationship: RELATIONSHIP,
    });
    expect(added).toContain("    Order *-- Line\n");
    expect(readClass(added).meaning.classes.map((item) => item.name)).toContain(
      "Line",
    );
  });

  it.each([
    ["a bad first class", { from: "1" }, "invalidName"],
    ["a bad second class", { to: "-" }, "invalidName"],
    ["an arrow it does not offer", { arrow: "<-->" }, "invalidArrow"],
    ["a quote in the label", { label: 'a"b' }, "invalidText"],
    [
      "a brace in the first cardinality",
      { fromCardinality: "{" },
      "invalidText",
    ],
    [
      "a quote in the second cardinality",
      { toCardinality: '"' },
      "invalidText",
    ],
  ])("refuses a relationship with %s", (_what, change, reason) => {
    expect(
      refusal(SOURCE, {
        kind: "addRelationship",
        relationship: { ...RELATIONSHIP, ...change } as ClassRelationship,
      }),
    ).toContain(reason);
  });

  it("changes and deletes a relationship by its index", () => {
    expect(
      apply(SOURCE, {
        kind: "updateRelationship",
        index: 0,
        relationship: {
          ...RELATIONSHIP,
          from: "Customer",
          to: "Order",
          label: "orders",
        },
      }),
    ).toContain("    Customer *-- Order : orders\n");
    expect(
      refusal(SOURCE, {
        kind: "updateRelationship",
        index: 0,
        relationship: { ...RELATIONSHIP, from: "?" },
      }),
    ).toContain("invalidName");
    expect(
      refusal(SOURCE, {
        kind: "updateRelationship",
        index: 4,
        relationship: RELATIONSHIP,
      }),
    ).toContain("unknownRelationship");
    const deleted = apply(SOURCE, { kind: "deleteRelationship", index: 0 });
    expect(deleted).not.toContain("-->");
    expect(refusal(SOURCE, { kind: "deleteRelationship", index: 2 })).toContain(
      "unknownRelationship",
    );
  });
});

describe("verifying a candidate", () => {
  it("accepts the classes in any order, and refuses another meaning or an unreadable text", () => {
    const read = readClass(SOURCE);
    const reversed = {
      ...read.meaning,
      classes: [...read.meaning.classes].reverse(),
    };
    expect(verifyClassCandidate(SOURCE, reversed).ok).toBe(true);
    const other = verifyClassCandidate(SOURCE, {
      ...read.meaning,
      relationships: [],
    });
    expect(!other.ok && other.error.kind).toBe("diagramMeaningMismatch");
    const unreadable = verifyClassCandidate(
      "classDiagram\n  class A {\n",
      read.meaning,
    );
    expect(!unreadable.ok && unreadable.error.kind).toBe("diagramNotEditable");
  });
});

const TWO_EACH = `classDiagram
    class Line {
        +int count
        +int price
    }
    A --> B
    B --> C
`;

describe("operations among several", () => {
  it("deletes a class with members, changing only the member or relationship named", () => {
    expect(apply(TWO_EACH, { kind: "deleteClass", name: "Line" })).toBe(
      "classDiagram\n    A --> B\n    B --> C\n",
    );
    expect(
      apply(TWO_EACH, {
        kind: "updateMember",
        className: "Line",
        index: 1,
        member: "+int total",
      }),
    ).toContain("        +int count\n        +int total\n");
    expect(
      apply(TWO_EACH, {
        kind: "updateRelationship",
        index: 1,
        relationship: { ...RELATIONSHIP, from: "B", to: "D" },
      }),
    ).toContain("    A --> B\n    B *-- D\n");
  });
});

describe("the class editor entry", () => {
  it("assesses a diagram and plans through the shared entry", () => {
    expect(CLASS_EDITOR.type).toBe("class");
    expect(CLASS_EDITOR.assess(SOURCE)).toEqual({ editable: true });
    expect(CLASS_EDITOR.assess("classDiagram\n    class A {\n").editable).toBe(
      false,
    );
  });
});
