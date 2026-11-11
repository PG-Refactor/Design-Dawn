// @vitest-environment jsdom
// The ER, state and class diagram operations against the real mermaid: the starting
// diagrams and every text an operation writes must be drawn by the real renderer through
// the render check the app uses. (The meaning is checked in the domain tests.)
import { beforeAll, describe, expect, it } from "vitest";
import {
  type DiagramOperation,
  planDiagramOperation,
} from "../../domain/diagram/diagram-operation";
import { analyzeDiagramSource } from "../../domain/diagram/diagram-source";
import { applyTextEdits } from "../../domain/diagram/text-edit";
import {
  DESIGN_TEMPLATE_IDS,
  DESIGN_TEMPLATES,
} from "../templates/design-templates";
import { createDiagramRenderCheck } from "./diagram-render-check";
import { MERMAID_TEMPLATES } from "./mermaid-templates";
import { mermaidRenderer } from "./render-mermaid";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";

beforeAll(installFakeSvgMeasurement);

const renderCheck = createDiagramRenderCheck(mermaidRenderer);

async function drawAfter(
  source: string,
  operations: readonly DiagramOperation[],
): Promise<string> {
  let text = source;
  for (const request of operations) {
    const plan = planDiagramOperation(text, request);
    if (!plan.ok) throw new Error(`refused: ${plan.error.detail}`);
    const applied = applyTextEdits(text, plan.value.edits);
    if (!applied.ok) throw new Error(applied.error.detail);
    expect(plan.value.verify(applied.value.text)).toEqual({
      ok: true,
      value: undefined,
    });
    text = applied.value.text;
    expect(await renderCheck(text), text).toEqual({ ok: true });
  }
  return text;
}

describe("the templates are editable and drawn", () => {
  it.each(["er", "state", "class"] as const)("%s", async (template) => {
    const source = MERMAID_TEMPLATES[template];
    expect(analyzeDiagramSource(source).editability).toEqual({
      editable: true,
      type: template,
    });
    expect(await renderCheck(source), template).toEqual({ ok: true });
  });
});

describe("ER operations", () => {
  it("writes ER text Mermaid draws", async () => {
    await drawAfter("erDiagram\n    CUSTOMER ||--o{ ORDER : places\n", [
      { diagram: "er", operation: { kind: "addEntity", name: "PRODUCT" } },
      {
        diagram: "er",
        operation: {
          kind: "addAttribute",
          entity: "PRODUCT",
          attribute: {
            type: "string",
            name: "sku",
            keys: ["PK", "UK"],
            comment: "code",
          },
        },
      },
      {
        diagram: "er",
        operation: {
          kind: "addRelationship",
          relationship: {
            left: "ORDER",
            leftCardinality: "}|",
            identifying: false,
            rightCardinality: "|{",
            right: "PRODUCT",
            label: "contains many",
          },
        },
      },
      {
        diagram: "er",
        operation: { kind: "deleteAttribute", entity: "PRODUCT", index: 0 },
      },
    ]);
  });
});

describe("state operations", () => {
  it("writes state text Mermaid draws", async () => {
    await drawAfter("stateDiagram-v2\n    [*] --> Draft\n", [
      {
        diagram: "state",
        operation: {
          kind: "addState",
          state: { id: "Review", description: "under review" },
        },
      },
      {
        diagram: "state",
        operation: {
          kind: "addTransition",
          transition: { from: "Draft", to: "Review", label: "submit" },
        },
      },
      {
        diagram: "state",
        operation: {
          kind: "updateState",
          state: { id: "Draft", description: "" },
        },
      },
      {
        diagram: "state",
        operation: {
          kind: "addTransition",
          transition: { from: "Review", to: "[*]", label: "" },
        },
      },
    ]);
  });
});

describe("class operations", () => {
  it("writes class text Mermaid draws", async () => {
    await drawAfter("classDiagram\n    class Order\n", [
      {
        diagram: "class",
        operation: {
          kind: "addMember",
          className: "Order",
          member: "+UUID id",
        },
      },
      { diagram: "class", operation: { kind: "addClass", name: "Customer" } },
      {
        diagram: "class",
        operation: {
          kind: "addRelationship",
          relationship: {
            from: "Customer",
            fromCardinality: "1",
            arrow: "-->",
            toCardinality: "*",
            to: "Order",
            label: "places",
          },
        },
      },
      {
        diagram: "class",
        operation: {
          kind: "updateRelationship",
          index: 0,
          relationship: {
            from: "Customer",
            fromCardinality: "",
            arrow: "..|>",
            toCardinality: "",
            to: "Order",
            label: "",
          },
        },
      },
    ]);
  });
});

describe("the diagrams of the design templates", () => {
  it.each(DESIGN_TEMPLATE_IDS)(
    "%s draws in both languages",
    async (templateId) => {
      for (const block of DESIGN_TEMPLATES[templateId].blocks) {
        if (block.blockType !== "mermaid") continue;
        for (const text of Object.values(block.text)) {
          expect(await renderCheck(text), text).toEqual({ ok: true });
        }
      }
    },
  );
});
