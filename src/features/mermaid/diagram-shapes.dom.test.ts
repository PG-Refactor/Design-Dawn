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

describe("sequence diagrams", () => {
  // Participants A (0..150 wide, top and bottom box) and B, a message A -> B along y = 114,
  // a note, and a second message B -> A at y = 156 that Mermaid numbered after the note.
  const SEQUENCE = `<svg xmlns="http://www.w3.org/2000/svg" id="dawn-mermaid-1" viewBox="0 0 400 400">
    <rect x="0" y="0" width="150" height="72" name="A" class="actor actor-top"/>
    <rect x="200" y="0" width="150" height="72" name="B" class="actor actor-top"/>
    <rect x="0" y="319" width="150" height="72" name="A" class="actor actor-bottom"/>
    <line x1="75" y1="72" x2="75" y2="319" data-et="life-line" data-id="A"/>
    <line x1="275" y1="72" x2="275" y2="319" data-et="life-line" data-id="B"/>
    <g data-et="note" data-id="i2"><rect x="300" y="166" width="90" height="36" class="note"/></g>
    <line x1="274" y1="156" x2="82" y2="156" data-et="message" data-id="i10"/>
    <line x1="76" y1="114" x2="268" y2="114" data-et="message" data-id="i0"/>
  </svg>`;
  const diagram = readDiagramShapes(SEQUENCE);
  if (diagram === null) throw new Error("not read");
  const shown = { width: 400, height: 400 };

  it("finds participants by id, top and bottom, and along their lifeline", () => {
    expect(shapeAt(diagram, { x: 20, y: 20 }, shown)).toEqual({
      kind: "participant",
      id: "A",
    });
    expect(shapeAt(diagram, { x: 20, y: 350 }, shown)?.id).toBe("A");
    expect(shapeAt(diagram, { x: 277, y: 250 }, shown)?.id).toBe("B");
  });

  it("numbers messages and notes in statement order, whatever the drawing order", () => {
    expect(shapeAt(diagram, { x: 150, y: 115 }, shown)).toEqual({
      kind: "message",
      id: "",
      ordinal: 0,
    });
    expect(shapeAt(diagram, { x: 150, y: 157 }, shown)).toEqual({
      kind: "message",
      id: "",
      ordinal: 1,
    });
    expect(shapeAt(diagram, { x: 320, y: 180 }, shown)).toEqual({
      kind: "note",
      id: "",
      ordinal: 0,
    });
  });
});

describe("Gantt charts", () => {
  const GANTT = `<svg xmlns="http://www.w3.org/2000/svg" id="dawn-mermaid-2" viewBox="0 0 300 100">
    <rect x="0" y="48" width="300" height="24" class="section section0"/>
    <rect id="dawn-mermaid-2-s1" x="75" y="50" width="40" height="20" class="task task0"/>
    <rect id="dawn-mermaid-2-task1" x="115" y="74" width="30" height="20" class="task task0"/>
  </svg>`;
  const diagram = readDiagramShapes(GANTT);
  if (diagram === null) throw new Error("not read");

  it("finds task bars by their id and their place in the chart", () => {
    const shown = { width: 300, height: 100 };
    expect(shapeAt(diagram, { x: 80, y: 60 }, shown)).toEqual({
      kind: "task",
      id: "s1",
      ordinal: 0,
    });
    expect(shapeAt(diagram, { x: 120, y: 80 }, shown)).toEqual({
      kind: "task",
      id: "task1",
      ordinal: 1,
    });
    // Away from the bars, the row's stripe stands for the first task's section.
    expect(shapeAt(diagram, { x: 250, y: 60 }, shown)).toEqual({
      kind: "section",
      id: "",
      ordinal: 0,
    });
    // Below every row, nothing.
    expect(shapeAt(diagram, { x: 250, y: 98 }, shown)).toBeNull();
  });
});

describe("pie charts", () => {
  // Mermaid's own output for "Dogs" 40, "Cats" 30, "Birds" 10 around (225, 225), r = 185:
  // Dogs on the right half, Cats bottom-left, Birds top-left; the legend names them by colour.
  const PIE = `<svg xmlns="http://www.w3.org/2000/svg" id="dawn-mermaid-3" viewBox="0 0 512 450">
    <g transform="translate(225,225)"><g>
      <circle cx="0" cy="0" r="186" class="pieOuterCircle"/>
      <path d="M0,-185A185,185,0,1,1,0,185L0,0Z" fill="#2859c0" class="pieCircle"/>
      <path d="M0,185A185,185,0,0,1,-130.815,-130.815L0,0Z" fill="#1a7a4c" class="pieCircle"/>
      <path d="M-130.815,-130.815A185,185,0,0,1,0,-185L0,0Z" fill="#b0541a" class="pieCircle"/>
    </g>
    <g class="legend" transform="translate(216,-33)"><rect width="18" height="18" style="fill: rgb(40, 89, 192); stroke: rgb(40, 89, 192);"/><text x="22" y="14">Dogs</text></g>
    <g class="legend" transform="translate(216,-11)"><rect width="18" height="18" style="fill: rgb(26, 122, 76);"/><text x="22" y="14">Cats</text></g>
    <g class="legend" transform="translate(216,11)"><rect width="18" height="18" style="fill: rgb(176, 84, 26);"/><text x="22" y="14">Birds</text></g>
    </g>
  </svg>`;
  const diagram = readDiagramShapes(PIE);
  if (diagram === null) throw new Error("not read");
  const shown = { width: 512, height: 450 };

  it("finds the slice under a point by its label", () => {
    expect(shapeAt(diagram, { x: 325, y: 225 }, shown)).toEqual({
      kind: "slice",
      id: "Dogs",
      ordinal: 0,
    });
    expect(shapeAt(diagram, { x: 150, y: 300 }, shown)?.id).toBe("Cats");
    expect(shapeAt(diagram, { x: 200, y: 100 }, shown)?.id).toBe("Birds");
    // Outside the circle.
    expect(shapeAt(diagram, { x: 10, y: 10 }, shown)).toBeNull();
  });

  it("finds the slice from its legend entry too", () => {
    expect(
      shapeAt(diagram, { x: 225 + 216 + 9, y: 225 - 11 + 9 }, shown),
    ).toEqual({ kind: "slice", id: "Cats", ordinal: 1 });
  });

  it("covers the whole circle for a single slice", () => {
    const whole =
      readDiagramShapes(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -100 200 200">
      <path d="M0,-90A90,90,0,1,1,0,90A90,90,0,1,1,0,-90Z" fill="#2859c0" class="pieCircle"/>
      <g class="legend"><rect width="1" height="1" x="500" style="fill: #2859c0"/><text>All</text></g>
    </svg>`);
    if (whole === null) throw new Error("not read");
    const square = { width: 200, height: 200 };
    for (const point of [
      { x: 150, y: 100 },
      { x: 50, y: 100 },
      { x: 100, y: 30 },
    ]) {
      expect(shapeAt(whole, point, square)?.id).toBe("All");
    }
  });
});

describe("sequence blocks and Gantt section rows", () => {
  it("numbers blocks by where they start, outer before inner, the coloured rect too", () => {
    // An outer loop (y 100..300) holding an opt (y 150..250); below them a coloured rect
    // block (y 320..380). Mermaid numbered the opt's end first.
    const diagram =
      readDiagramShapes(`<svg xmlns="http://www.w3.org/2000/svg" aria-roledescription="sequence" viewBox="0 0 400 400">
      <g data-et="control-structure" data-id="i5">
        <line x1="70" y1="150" x2="290" y2="150"/><line x1="70" y1="250" x2="290" y2="250"/>
      </g>
      <g data-et="control-structure" data-id="i6">
        <line x1="60" y1="100" x2="300" y2="100"/><line x1="60" y1="300" x2="300" y2="300"/>
      </g>
      <rect x="60" y="320" width="240" height="60" class="rect"/>
    </svg>`);
    if (diagram === null) throw new Error("not read");
    const shown = { width: 400, height: 400 };
    expect(shapeAt(diagram, { x: 80, y: 120 }, shown)).toEqual({
      kind: "block",
      id: "",
      ordinal: 0,
    });
    // Inside both: the inner (smaller) block.
    expect(shapeAt(diagram, { x: 80, y: 200 }, shown)?.ordinal).toBe(1);
    expect(shapeAt(diagram, { x: 80, y: 350 }, shown)?.ordinal).toBe(2);
  });

  it("does not take a flowchart's rect for a block", () => {
    const diagram =
      readDiagramShapes(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect x="0" y="0" width="100" height="100" class="rect"/>
    </svg>`);
    expect(diagram?.areas).toEqual([]);
  });

  it("tells the section row of each task, one stripe per task", () => {
    const diagram =
      readDiagramShapes(`<svg xmlns="http://www.w3.org/2000/svg" id="g" viewBox="0 0 300 100">
      <rect x="0" y="0" width="300" height="24" class="section section0"/>
      <rect x="0" y="24" width="300" height="24" class="section section1"/>
      <rect id="g-a" x="100" y="2" width="40" height="20" class="task task0"/>
    </svg>`);
    if (diagram === null) throw new Error("not read");
    const shown = { width: 300, height: 100 };
    expect(shapeAt(diagram, { x: 250, y: 30 }, shown)).toEqual({
      kind: "section",
      id: "",
      ordinal: 1,
    });
    // On the bar, the task.
    expect(shapeAt(diagram, { x: 110, y: 10 }, shown)?.kind).toBe("task");
  });
});

describe("an empty subgraph", () => {
  it("is found around its title, though its frame has no height", () => {
    // Mermaid's output: the frame at y = 20 from x -12 to 36, the title on it.
    const diagram =
      readDiagramShapes(`<svg xmlns="http://www.w3.org/2000/svg" id="dawn-mermaid-1" viewBox="-20 0 100 100">
      <g class="clusters"><g class="cluster" id="dawn-mermaid-1-empty1">
        <rect x="-12" y="20" width="48" height="0"/>
        <g class="cluster-label" transform="translate(-8, 20)"><text y="-10.1">Empty</text></g>
      </g></g>
    </svg>`);
    if (diagram === null) throw new Error("not read");
    const shown = { width: 100, height: 100 };
    // (0, 20) on screen is (-20 + 0, 20) in the drawing: left of the frame.
    expect(shapeAt(diagram, { x: 10, y: 22 }, shown)).toEqual({
      kind: "subgraph",
      id: "empty1",
    });
    expect(shapeAt(diagram, { x: 10, y: 60 }, shown)).toBeNull();
  });
});
