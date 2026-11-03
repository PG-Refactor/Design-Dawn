// Where the shapes of a drawn diagram are, so a click on the diagram image can be turned
// into "this node". The diagram is shown as an <img> (its SVG never becomes part of the
// page), so the sanitised SVG text is parsed here into plain boxes instead; nothing of it
// is inserted anywhere.

// What a point on the diagram is over. Only flowchart nodes are told apart so far; any
// other point is the diagram itself (`null`).
export interface DiagramHit {
  readonly kind: "node";
  readonly id: string;
}

export interface DiagramBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DiagramShapes {
  readonly viewBox: DiagramBox;
  readonly shapes: readonly {
    readonly hit: DiagramHit;
    readonly box: DiagramBox;
  }[];
}

const SVG_MIME = "image/svg+xml";
// Mermaid gives each flowchart node `<svg id>-flowchart-<node id>-<counter>`.
const FLOWCHART_NODE_ID = /-flowchart-(.+)-\d+$/;
const TRANSLATE = /translate\(\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?\s*\)/;
const NUMBER = /-?\d*\.?\d+(?:e-?\d+)?/gi;
const VIEW_BOX_PARTS = 4;

function numberAttribute(element: Element, name: string): number {
  const value = Number(element.getAttribute(name));
  return Number.isFinite(value) ? value : 0;
}

// The offset of all `translate(...)` transforms from `element` up to the root. Mermaid
// places nodes (and subgraph contents) with translations only.
function offsetOf(element: Element): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (
    let current: Element | null = element;
    current !== null;
    current = current.parentElement
  ) {
    const match = TRANSLATE.exec(current.getAttribute("transform") ?? "");
    if (match !== null) {
      x += Number(match[1]);
      y += Number(match[2] ?? 0);
    }
  }
  return { x, y };
}

// How many numbers each path command takes per repetition.
const PATH_ARGUMENTS: Readonly<Record<string, number>> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};
const PATH_COMMAND = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;

// The points a path passes through (the end point of every segment, as x, y pairs), with
// relative commands followed from the pen position. Curves bulge a little past these
// points; for a click target that is close enough.
function pathPoints(d: string): number[] {
  const points: number[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  for (const [, command = "", rest = ""] of d.matchAll(PATH_COMMAND)) {
    const lower = command.toLowerCase();
    const relative = command === lower;
    const count = PATH_ARGUMENTS[lower] ?? 0;
    const numbers = (rest.match(NUMBER) ?? []).map(Number);
    if (count === 0) {
      x = startX;
      y = startY;
      continue;
    }
    for (let index = 0; index + count <= numbers.length; index += count) {
      const args = numbers.slice(index, index + count);
      if (lower === "h") {
        x = (relative ? x : 0) + (args[0] ?? 0);
      } else if (lower === "v") {
        y = (relative ? y : 0) + (args[0] ?? 0);
      } else {
        x = (relative ? x : 0) + (args[count - 2] ?? 0);
        y = (relative ? y : 0) + (args[count - 1] ?? 0);
      }
      if (lower === "m" && index === 0) {
        startX = x;
        startY = y;
      }
      points.push(x, y);
    }
  }
  return points;
}

function boxOfPoints(values: readonly number[]): DiagramBox | null {
  const xs = values.filter((_, index) => index % 2 === 0);
  const ys = values.filter((_, index) => index % 2 === 1);
  if (xs.length === 0 || ys.length === 0) return null;
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    x: left,
    y: top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  };
}

// The node's outline: its rectangle, polygon (diamond, hexagon ...), circle / ellipse, or
// path (stadium, cylinder ...).
function outlineOf(node: Element): Element | null {
  return node.querySelector(
    "rect.label-container, rect, polygon, circle, ellipse, path",
  );
}

// The box of an outline in its own coordinates (before any transform): the rectangle,
// the extent of the polygon's points or the path's coordinates, or the circle's square.
function localBox(outline: Element): DiagramBox | null {
  const rect = outline.localName === "rect" ? outline : null;
  if (rect !== null && numberAttribute(rect, "width") > 0) {
    return {
      x: numberAttribute(rect, "x"),
      y: numberAttribute(rect, "y"),
      width: numberAttribute(rect, "width"),
      height: numberAttribute(rect, "height"),
    };
  }
  const polygon = outline.localName === "polygon" ? outline : null;
  if (polygon !== null) {
    return boxOfPoints(
      (polygon.getAttribute("points")?.match(NUMBER) ?? []).map(Number),
    );
  }
  const round =
    outline.localName === "circle" || outline.localName === "ellipse"
      ? outline
      : null;
  if (round !== null) {
    const rx = numberAttribute(round, "r") || numberAttribute(round, "rx");
    const ry = numberAttribute(round, "r") || numberAttribute(round, "ry");
    return {
      x: numberAttribute(round, "cx") - rx,
      y: numberAttribute(round, "cy") - ry,
      width: rx * 2,
      height: ry * 2,
    };
  }
  const path = outline.localName === "path" ? outline : null;
  if (path !== null)
    return boxOfPoints(pathPoints(path.getAttribute("d") ?? ""));
  return null;
}

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
  const shapes = [...root.querySelectorAll("g.node")].flatMap((node) => {
    const match = FLOWCHART_NODE_ID.exec(node.getAttribute("id") ?? "");
    const outline = outlineOf(node);
    const box = outline === null ? null : localBox(outline);
    if (match?.[1] === undefined || outline === null || box === null) return [];
    // From the outline up: Mermaid moves some outlines (the diamond) with a transform of
    // their own inside the node's group.
    const offset = offsetOf(outline);
    return [
      {
        hit: { kind: "node", id: match[1] } as const,
        box: { ...box, x: box.x + offset.x, y: box.y + offset.y },
      },
    ];
  });
  return { viewBox: { x, y, width, height }, shapes };
}

// The shape under a point of the shown image (`point` relative to the image element's
// top-left, `shown` its size on screen). The image keeps its aspect ratio inside its box
// (`object-fit: contain`), so the diagram may be centred with empty bands around it. The
// smallest shape wins where shapes overlap (a node inside a subgraph).
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
  const under = diagram.shapes.filter(
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
