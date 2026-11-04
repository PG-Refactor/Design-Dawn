// Where the shapes of a drawn diagram are, so a click on the diagram image can be turned
// into "this node", "this message" or "this slice". The diagram is shown as an <img> (its
// SVG never becomes part of the page), so the sanitised SVG text is parsed here into plain
// geometry instead; nothing of it is inserted anywhere.

import { DIAGRAM_LINE_HIT_REACH_PX } from "../../config/mermaid-preview-config";
import { readDiagramLayers, wedgeContains } from "./diagram-shape-readers";
import type { DiagramBox } from "./diagram-svg-geometry";

export type { DiagramBox } from "./diagram-svg-geometry";

export type DiagramHitKind =
  // flowchart
  | "node"
  | "edge"
  | "subgraph"
  // sequence diagram
  | "participant"
  | "message"
  | "note"
  | "block"
  // Gantt chart
  | "task"
  | "section"
  // pie chart
  | "slice";

// What a point on the diagram is over. `id` is what the source calls it (a flowchart node
// or edge id, a participant id, a Gantt task id, a pie slice's label), "" when the drawing
// does not tell. `ordinal` is its position among the shapes of its kind in source order,
// for the kinds whose elements have no name of their own (sequence messages, notes and
// blocks, the Gantt sections of task rows) or may lack one (Gantt tasks, pie slices). Any other point is the diagram itself (`null`).
export interface DiagramHit {
  readonly kind: DiagramHitKind;
  readonly id: string;
  readonly ordinal?: number;
}

export interface DiagramShape {
  readonly hit: DiagramHit;
  readonly box: DiagramBox;
}

export interface DiagramLine {
  readonly hit: DiagramHit;
  // The points the line passes through, as x, y pairs in diagram coordinates.
  readonly points: readonly number[];
}

// A pie slice: the part of the circle around `center` covered by its arcs (angles in
// radians, growing clockwise on screen, from `start` over `length`).
export interface DiagramWedge {
  readonly hit: DiagramHit;
  readonly center: { readonly x: number; readonly y: number };
  readonly radius: number;
  readonly arcs: readonly { readonly start: number; readonly length: number }[];
}

// Four layers, looked up in this order: what is drawn on top (nodes, labels, participant
// boxes, notes, task bars, legend entries), pie slices, lines (edges, messages, lifelines),
// and the areas around everything else (subgraphs, sequence blocks, Gantt section rows).
export interface DiagramShapes {
  readonly viewBox: DiagramBox;
  readonly shapes: readonly DiagramShape[];
  readonly wedges: readonly DiagramWedge[];
  readonly lines: readonly DiagramLine[];
  readonly areas: readonly DiagramShape[];
}

const SVG_MIME = "image/svg+xml";
const VIEW_BOX_PARTS = 4;

export function readDiagramShapes(svg: string): DiagramShapes | null {
  const document = new DOMParser().parseFromString(svg, SVG_MIME);
  const root = document.documentElement;
  const parts = (root.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    parts.length !== VIEW_BOX_PARTS ||
    parts.some((part) => !Number.isFinite(part))
  ) {
    return null;
  }
  const [x = 0, y = 0, width = 0, height = 0] = parts;
  if (width <= 0 || height <= 0) return null;
  return { viewBox: { x, y, width, height }, ...readDiagramLayers(root) };
}

// The distance from a point to the segment between two others.
function distanceToSegment(
  x: number,
  y: number,
  from: readonly [number, number],
  to: readonly [number, number],
): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;
  const along =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((x - from[0]) * dx + (y - from[1]) * dy) / lengthSquared,
          ),
        );
  return Math.hypot(x - (from[0] + along * dx), y - (from[1] + along * dy));
}

function distanceToLine(
  x: number,
  y: number,
  points: readonly number[],
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 3 < points.length; index += 2) {
    nearest = Math.min(
      nearest,
      distanceToSegment(
        x,
        y,
        [points[index] ?? 0, points[index + 1] ?? 0],
        [points[index + 2] ?? 0, points[index + 3] ?? 0],
      ),
    );
  }
  return nearest;
}

function smallestBoxAt(
  shapes: readonly DiagramShape[],
  x: number,
  y: number,
): DiagramHit | null {
  const under = shapes.filter(
    ({ box }) =>
      x >= box.x &&
      x <= box.x + box.width &&
      y >= box.y &&
      y <= box.y + box.height,
  );
  under.sort(
    (first, second) =>
      first.box.width * first.box.height - second.box.width * second.box.height,
  );
  return under[0]?.hit ?? null;
}

// The shape under a point of the shown image (`point` relative to the image element's
// top-left, `shown` its size on screen). The image keeps its aspect ratio inside its box
// (`object-fit: contain`), so the diagram may be centred with empty bands around it. The
// layers are looked up in order (see `DiagramShapes`); among boxes of one layer the
// smallest wins (a subgraph inside another), among lines the nearest.
export function shapeAt(
  diagram: DiagramShapes,
  point: { readonly x: number; readonly y: number },
  shown: { readonly width: number; readonly height: number },
): DiagramHit | null {
  const { viewBox } = diagram;
  const scale = Math.min(
    shown.width / viewBox.width,
    shown.height / viewBox.height,
  );
  if (!(scale > 0)) return null;
  const left = (shown.width - viewBox.width * scale) / 2;
  const top = (shown.height - viewBox.height * scale) / 2;
  const x = viewBox.x + (point.x - left) / scale;
  const y = viewBox.y + (point.y - top) / scale;
  const onTop = smallestBoxAt(diagram.shapes, x, y);
  if (onTop !== null) return onTop;
  const wedge = diagram.wedges.find((candidate) =>
    wedgeContains(candidate, x, y),
  );
  if (wedge !== undefined) return wedge.hit;
  // A line is a few screen pixels wide whatever the zoom, so the reach is measured on the
  // screen and turned into diagram units.
  const reach = DIAGRAM_LINE_HIT_REACH_PX / scale;
  let nearestLine: DiagramHit | null = null;
  let nearestDistance = reach;
  for (const line of diagram.lines) {
    const distance = distanceToLine(x, y, line.points);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestLine = line.hit;
    }
  }
  return nearestLine ?? smallestBoxAt(diagram.areas, x, y);
}
