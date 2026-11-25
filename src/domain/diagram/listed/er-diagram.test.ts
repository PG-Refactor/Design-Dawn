import { describe, expect, it } from "vitest";
import { applyTextEdits } from "../text-edit";
import {
  attributeText,
  ER_EDITOR,
  type ErAttribute,
  type ErOperation,
  type ErRelationship,
  planErOperation,
  readEr,
  relationshipText,
  verifyErCandidate,
} from "./er-diagram";

const SOURCE = `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER {
        string id PK
        int total "in yen"
    }
    EMPTY {
    }
    PRODUCT
`;

function apply(source: string, operation: ErOperation): string {
  const plan = planErOperation(source, operation);
  if (!plan.ok) throw new Error(`refused: ${plan.error.detail}`);
  const applied = applyTextEdits(source, plan.value.edits);
  if (!applied.ok) throw new Error(applied.error.detail);
  const verified = verifyErCandidate(applied.value.text, plan.value.expected);
  if (!verified.ok) throw new Error(`not verified: ${verified.error.kind}`);
  return applied.value.text;
}

function refusal(source: string, operation: ErOperation): string {
  const plan = planErOperation(source, operation);
  return plan.ok ? "" : plan.error.detail;
}

const ATTRIBUTE: ErAttribute = {
  type: "string",
  name: "sku",
  keys: [],
  comment: "",
};

const RELATIONSHIP: ErRelationship = {
  left: "ORDER",
  leftCardinality: "||",
  identifying: false,
  rightCardinality: "|{",
  right: "LINE",
  label: "contains",
};

describe("reading an ER diagram", () => {
  it("reads entities in the order they are named, keys and comments", () => {
    const read = readEr(SOURCE);
    expect(read.editable).toBe(true);
    expect(read.meaning.entities.map((entity) => entity.name)).toEqual([
      "CUSTOMER",
      "ORDER",
      "EMPTY",
      "PRODUCT",
    ]);
    expect(
      readEr("erDiagram\n    A {\n        int id PK, FK\n    }\n").meaning
        .entities[0]?.attributes[0]?.keys,
    ).toEqual(["PK", "FK"]);
  });

  it("is not editable without its header, or with front matter", () => {
    expect(readEr("classDiagram\n").notReadable?.reason).toBe(
      "unsupportedLines",
    );
    expect(
      readEr("---\ntitle: T\n---\nerDiagram\n    A\n").notReadable?.reason,
    ).toBe("structureIssue");
  });

  it.each([
    [
      "an attribute it cannot read",
      "    A {\n        not an attribute line\n    }\n",
    ],
    ["a block after a bare entity", "    A\n    A {\n    }\n"],
    ["a bare entity declared twice", "    A\n    A\n"],
    ["a bare entity after its block", "    A {\n    }\n    A\n"],
    ["a block never closed", "    A {\n"],
    ["a line it does not know", "    direction LR\n"],
  ])("is not editable with %s", (_what, body) => {
    expect(readEr(`erDiagram\n${body}`).editable).toBe(false);
  });

  it("accepts a block for an entity a relationship named first", () => {
    expect(
      readEr("erDiagram\n    A ||--|| B : r\n    A {\n    }\n").editable,
    ).toBe(true);
  });
});

describe("texts", () => {
  it("writes keys and a comment only when there are some", () => {
    expect(attributeText(ATTRIBUTE)).toBe("string sku");
    expect(
      attributeText({ ...ATTRIBUTE, keys: ["PK", "UK"], comment: "code" }),
    ).toBe('string sku PK, UK "code"');
  });

  it("writes the line by identifying, and quotes a label that is not one word", () => {
    expect(relationshipText(RELATIONSHIP)).toBe("ORDER ||..|{ LINE : contains");
    expect(
      relationshipText({
        ...RELATIONSHIP,
        identifying: true,
        label: "has many",
      }),
    ).toBe('ORDER ||--|{ LINE : "has many"');
  });
});

describe("ER operations", () => {
  it("refuses everything on a diagram it cannot edit", () => {
    expect(
      refusal("erDiagram\n    A {\n", { kind: "addEntity", name: "B" }),
    ).toContain("notEditable");
  });

  it("adds an entity, refusing a bad or taken name", () => {
    expect(apply(SOURCE, { kind: "addEntity", name: "LINE" })).toContain(
      "    LINE\n",
    );
    expect(refusal(SOURCE, { kind: "addEntity", name: "a b" })).toContain(
      "invalidName",
    );
    expect(refusal(SOURCE, { kind: "addEntity", name: "ORDER" })).toContain(
      "duplicateName",
    );
  });

  it("deletes a bare entity or a block, unless a relationship uses it", () => {
    expect(
      apply(SOURCE, { kind: "deleteEntity", name: "PRODUCT" }),
    ).not.toContain("PRODUCT");
    expect(
      apply(SOURCE, { kind: "deleteEntity", name: "EMPTY" }),
    ).not.toContain("EMPTY");
    expect(refusal(SOURCE, { kind: "deleteEntity", name: "ORDER" })).toContain(
      "entityInUse",
    );
    expect(refusal(SOURCE, { kind: "deleteEntity", name: "NONE" })).toContain(
      "unknownEntity",
    );
  });

  it("adds an attribute into an empty block, after the last one, or opening a block", () => {
    expect(
      apply(SOURCE, {
        kind: "addAttribute",
        entity: "EMPTY",
        attribute: ATTRIBUTE,
      }),
    ).toContain("    EMPTY {\n        string sku\n    }");
    expect(
      apply(SOURCE, {
        kind: "addAttribute",
        entity: "ORDER",
        attribute: ATTRIBUTE,
      }),
    ).toContain('int total "in yen"\n        string sku\n    }');
    expect(
      apply(SOURCE, {
        kind: "addAttribute",
        entity: "CUSTOMER",
        attribute: ATTRIBUTE,
      }),
    ).toContain("    CUSTOMER {\n        string sku\n    }\n");
  });

  it("turns a bare entity on the last line (no line break) into a block", () => {
    const source = "erDiagram\n    PRODUCT";
    expect(
      apply(source, {
        kind: "addAttribute",
        entity: "PRODUCT",
        attribute: ATTRIBUTE,
      }),
    ).toBe("erDiagram\n    PRODUCT {\n        string sku\n    }");
  });

  it.each([
    ["a space in the type", { type: "big int" }, "invalidText"],
    ["a quote in the name", { name: 'a"' }, "invalidText"],
    ["a brace in the comment", { comment: "{" }, "invalidText"],
    ["an empty name", { name: " " }, "emptyText"],
  ])("refuses an attribute with %s", (_what, change, reason) => {
    expect(
      refusal(SOURCE, {
        kind: "addAttribute",
        entity: "ORDER",
        attribute: { ...ATTRIBUTE, ...change },
      }),
    ).toContain(reason);
  });

  it("refuses an attribute for an unknown entity", () => {
    expect(
      refusal(SOURCE, {
        kind: "addAttribute",
        entity: "NONE",
        attribute: ATTRIBUTE,
      }),
    ).toContain("unknownEntity");
  });

  it("changes an attribute, refusing one that is not there", () => {
    expect(
      apply(SOURCE, {
        kind: "updateAttribute",
        entity: "ORDER",
        index: 1,
        attribute: { ...ATTRIBUTE, name: "amount" },
      }),
    ).toContain("        string id PK\n        string amount\n");
    for (const [entity, index] of [
      ["ORDER", 5],
      ["PRODUCT", 0],
      ["NONE", 0],
    ] as const) {
      expect(
        refusal(SOURCE, {
          kind: "updateAttribute",
          entity,
          index,
          attribute: ATTRIBUTE,
        }),
      ).toContain("unknownAttribute");
    }
    expect(
      refusal(SOURCE, {
        kind: "updateAttribute",
        entity: "ORDER",
        index: 0,
        attribute: { ...ATTRIBUTE, type: "" },
      }),
    ).toContain("emptyText");
  });

  it("deletes an attribute, refusing one that is not there", () => {
    expect(
      apply(SOURCE, { kind: "deleteAttribute", entity: "ORDER", index: 0 }),
    ).toContain('    ORDER {\n        int total "in yen"\n    }');
    for (const [entity, index] of [
      ["ORDER", 9],
      ["PRODUCT", 0],
      ["NONE", 0],
    ] as const) {
      expect(
        refusal(SOURCE, { kind: "deleteAttribute", entity, index }),
      ).toContain("unknownAttribute");
    }
  });

  it("adds, changes and deletes relationships", () => {
    const added = apply(SOURCE, {
      kind: "addRelationship",
      relationship: RELATIONSHIP,
    });
    expect(added).toContain("    ORDER ||..|{ LINE : contains\n");
    expect(
      apply(added, {
        kind: "updateRelationship",
        index: 1,
        relationship: { ...RELATIONSHIP, label: "holds" },
      }),
    ).toContain("    ORDER ||..|{ LINE : holds\n");
    expect(apply(added, { kind: "deleteRelationship", index: 1 })).toBe(SOURCE);
    expect(
      refusal(SOURCE, {
        kind: "updateRelationship",
        index: 3,
        relationship: RELATIONSHIP,
      }),
    ).toContain("unknownRelationship");
    expect(refusal(SOURCE, { kind: "deleteRelationship", index: 3 })).toContain(
      "unknownRelationship",
    );
  });

  it.each([
    ["a bad left entity", { left: "1A" }, "invalidName"],
    ["a bad right entity", { right: "" }, "invalidName"],
    ["a quote in the label", { label: 'a"b' }, "invalidText"],
    ["an empty label", { label: "" }, "emptyText"],
  ])("refuses a relationship with %s", (_what, change, reason) => {
    expect(
      refusal(SOURCE, {
        kind: "addRelationship",
        relationship: { ...RELATIONSHIP, ...change },
      }),
    ).toContain(reason);
    expect(
      refusal(SOURCE, {
        kind: "updateRelationship",
        index: 0,
        relationship: { ...RELATIONSHIP, ...change },
      }),
    ).toContain(reason);
  });
});

describe("the ER editor entry", () => {
  it("assesses a diagram", () => {
    expect(ER_EDITOR.type).toBe("er");
    expect(ER_EDITOR.assess(SOURCE)).toEqual({ editable: true });
    expect(ER_EDITOR.assess("erDiagram\n    A {\n").editable).toBe(false);
  });
});
