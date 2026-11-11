// @vitest-environment jsdom
// The shapes of ER, state and class diagrams as the real Mermaid draws them: every box is
// named as the editor's lists name it, and the lines are numbered in source order (a
// note's link in a state diagram takes a number of Mermaid's but is not a transition).
import { beforeAll, describe, expect, it } from "vitest";
import { readClass } from "../../domain/diagram/listed/class-diagram";
import { readEr } from "../../domain/diagram/listed/er-diagram";
import { readState } from "../../domain/diagram/listed/state-diagram";
import { type DiagramHit, readDiagramShapes } from "./diagram-shapes";
import { mermaidRenderer } from "./render-mermaid";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";

beforeAll(installFakeSvgMeasurement);

async function hitsOf(source: string): Promise<DiagramHit[]> {
  const rendered = await mermaidRenderer.render(source, {});
  if (!rendered.ok) throw new Error(rendered.message);
  const shapes = readDiagramShapes(rendered.svg);
  if (shapes === null) throw new Error("no shapes");
  return [...shapes.shapes, ...shapes.lines, ...shapes.areas].map(
    (shape) => shape.hit,
  );
}

function namesOf(hits: readonly DiagramHit[], kind: DiagramHit["kind"]) {
  return [
    ...new Set(hits.filter((hit) => hit.kind === kind).map((hit) => hit.id)),
  ].sort();
}

function ordinalsOf(hits: readonly DiagramHit[], kind: DiagramHit["kind"]) {
  return [
    ...new Set(
      hits.filter((hit) => hit.kind === kind).map((hit) => hit.ordinal),
    ),
  ].sort();
}

describe("shapes of the list-edited diagrams", () => {
  it("ER: entities by name, relationships in source order", async () => {
    const source =
      "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ITEM }|--|| ORDER : in\n  ORDER {\n    string id PK\n  }\n  CUSTOMER ||--o{ ORDER : returns\n";
    const hits = await hitsOf(source);
    const meaning = readEr(source).meaning;
    expect(namesOf(hits, "entity")).toEqual(
      meaning.entities.map((entity) => entity.name).sort(),
    );
    expect(ordinalsOf(hits, "relationship")).toEqual([0, 1, 2]);
    expect(meaning.relationships).toHaveLength(3);
    expect(hits.some((hit) => hit.kind === "edge")).toBe(false);
  });

  it("state: states by id, transitions in source order past a note", async () => {
    const source =
      "stateDiagram-v2\n  [*] --> Idle\n  note right of Idle : waits\n  Idle --> Busy : go\n  Busy : working\n  Busy --> [*]\n";
    const hits = await hitsOf(source);
    const meaning = readState(source).meaning;
    expect(namesOf(hits, "state")).toEqual(
      meaning.states.map((state) => state.id).sort(),
    );
    expect(ordinalsOf(hits, "transition")).toEqual([0, 1, 2]);
    expect(meaning.transitions).toHaveLength(3);
  });

  it("class: classes by name, relationships in source order", async () => {
    const source =
      "classDiagram\n  class Order {\n    +String id\n  }\n  Order <|-- Special_Order\n  Customer --> Order : places\n";
    const hits = await hitsOf(source);
    const meaning = readClass(source).meaning;
    expect(namesOf(hits, "class")).toEqual(
      meaning.classes.map((item) => item.name).sort(),
    );
    expect(ordinalsOf(hits, "relationship")).toEqual([0, 1]);
    expect(meaning.relationships).toHaveLength(2);
  });
});
