// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readDiagramShapes, shapeAt } from "./diagram-shapes";

// The shape of Mermaid's flowchart output: nodes are groups placed by translations, with
// a rectangle, a polygon (diamond) or a path (stadium) as their outline.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 216 116" width="216" height="116">
  <g class="root">
    <g class="nodes">
      <g class="node default" id="dawn-mermaid-1-flowchart-Start-0" transform="translate(50, 20)">
        <rect class="basic label-container" x="-40" y="-15" width="80" height="30"/>
      </g>
      <g class="node default" id="dawn-mermaid-1-flowchart-is-valid-1" transform="translate(150, 20)">
        <polygon points="20,0 40,-20 20,-40 0,-20" transform="translate(-20, 20)"/>
      </g>
    </g>
    <g class="root" transform="translate(0, 60)">
      <g class="node default" id="dawn-mermaid-1-flowchart-Done-2" transform="translate(50, 20)">
        <path d="M-30,-10 a5,5 0,0,0 60,0 l0,20 h-60 v-20 Z"/>
      </g>
    </g>
  </g>
</svg>`;

describe("readDiagramShapes", () => {
  it("finds every flowchart node with its box in diagram coordinates", () => {
    const diagram = readDiagramShapes(SVG);
    expect(diagram?.viewBox).toEqual({ x: -8, y: -8, width: 216, height: 116 });
    expect(diagram?.shapes).toEqual([
      {
        hit: { kind: "node", id: "Start" },
        box: { x: 10, y: 5, width: 80, height: 30 },
      },
      // An id with a hyphen stays whole; the diamond's own translation counts.
      {
        hit: { kind: "node", id: "is-valid" },
        box: { x: 130, y: 0, width: 40, height: 40 },
      },
      // A path with relative commands (a cylinder); inside a translated group (a
      // subgraph): both translations count.
      {
        hit: { kind: "node", id: "Done" },
        box: { x: 20, y: 70, width: 60, height: 20 },
      },
    ]);
  });

  it("gives nothing for an SVG without a usable viewBox", () => {
    expect(
      readDiagramShapes(`<svg xmlns="http://www.w3.org/2000/svg"/>`),
    ).toBeNull();
  });
});

describe("shapeAt", () => {
  const diagram = readDiagramShapes(SVG);
  if (diagram === null) throw new Error("not read");

  it("maps a point of the shown image to the node under it", () => {
    // Shown at its own size: image px + viewBox origin = diagram coordinates.
    const shown = { width: 216, height: 116 };
    expect(shapeAt(diagram, { x: 58, y: 28 }, shown)).toEqual({
      kind: "node",
      id: "Start",
    });
    expect(shapeAt(diagram, { x: 158, y: 28 }, shown)).toEqual({
      kind: "node",
      id: "is-valid",
    });
    expect(shapeAt(diagram, { x: 58, y: 88 }, shown)).toEqual({
      kind: "node",
      id: "Done",
    });
    expect(shapeAt(diagram, { x: 200, y: 100 }, shown)).toBeNull();
  });

  it("follows the scale and the centring of a contained image", () => {
    // Twice as wide a box: the diagram is drawn at scale 1 and centred horizontally.
    const shown = { width: 432, height: 116 };
    expect(shapeAt(diagram, { x: 108 + 58, y: 28 }, shown)).toEqual({
      kind: "node",
      id: "Start",
    });
    // Half size: every coordinate halves.
    expect(
      shapeAt(diagram, { x: 29, y: 14 }, { width: 108, height: 58 }),
    ).toEqual({
      kind: "node",
      id: "Start",
    });
  });
});

describe("edges and subgraphs", () => {
  // A subgraph `grp` (0..100, 0..60) holding node A, an edge A -> B leaving it along
  // y = 20 and another drawn inside a translated group.
  const GROUPED = `<svg xmlns="http://www.w3.org/2000/svg" id="dawn-mermaid-3" viewBox="0 0 200 100">
    <g class="clusters">
      <g class="cluster" id="dawn-mermaid-3-grp"><rect x="0" y="0" width="100" height="60"/></g>
    </g>
    <g class="edgePaths">
      <path d="M60,20L140,20" data-edge="true" data-id="L_A_B_0"/>
      <g transform="translate(0, 50)"><path d="M150,0l0,40" data-edge="true" data-id="custom"/></g>
    </g>
    <g class="edgeLabels">
      <g class="edgeLabel"><g class="label" data-id="L_A_B_0" transform="translate(100, 10)"><rect x="-10" y="-5" width="20" height="10"/></g></g>
    </g>
    <g class="node default" id="dawn-mermaid-3-flowchart-A-0" transform="translate(30, 20)">
      <rect x="-20" y="-10" width="40" height="20"/>
    </g>
  </svg>`;
  const diagram = readDiagramShapes(GROUPED);
  if (diagram === null) throw new Error("not read");
  const shown = { width: 200, height: 100 };

  it("reads edges as lines and subgraphs as areas, by their source ids", () => {
    expect(diagram.lines).toEqual([
      { hit: { kind: "edge", id: "L_A_B_0" }, points: [60, 20, 140, 20] },
      { hit: { kind: "edge", id: "custom" }, points: [150, 50, 150, 90] },
    ]);
    expect(diagram.areas).toEqual([
      {
        hit: { kind: "subgraph", id: "grp" },
        box: { x: 0, y: 0, width: 100, height: 60 },
      },
    ]);
  });

  it("finds a node first, then an edge's label or line, then the subgraph", () => {
    expect(shapeAt(diagram, { x: 30, y: 20 }, shown)).toEqual({
      kind: "node",
      id: "A",
    });
    // On the label, away from the line.
    expect(shapeAt(diagram, { x: 105, y: 7 }, shown)?.id).toBe("L_A_B_0");
    // Near the line, inside the subgraph.
    expect(shapeAt(diagram, { x: 70, y: 23 }, shown)).toEqual({
      kind: "edge",
      id: "L_A_B_0",
    });
    expect(shapeAt(diagram, { x: 152, y: 70 }, shown)?.id).toBe("custom");
    expect(shapeAt(diagram, { x: 70, y: 45 }, shown)).toEqual({
      kind: "subgraph",
      id: "grp",
    });
    expect(shapeAt(diagram, { x: 180, y: 10 }, shown)).toBeNull();
  });

  it("reaches a line by screen pixels, whatever the picture's scale", () => {
    // Shown at half size: 4 screen px off the line is 8 diagram units off.
    const half = { width: 100, height: 50 };
    expect(shapeAt(diagram, { x: 60, y: 14 }, half)?.kind).toBe("edge");
    expect(shapeAt(diagram, { x: 60, y: 25 }, half)).toBeNull();
  });
});
