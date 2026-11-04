// Reading positions out of a drawn diagram's SVG text (parsed, never inserted into the
// page): the boxes of outlines, the points of lines and paths, and the translations Mermaid
// places groups with.

export interface DiagramBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const TRANSLATE = /translate\(\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?\s*\)/;
export const SVG_NUMBER = /-?\d*\.?\d+(?:e-?\d+)?/gi;

export function numberAttribute(element: Element, name: string): number {
  const value = Number(element.getAttribute(name));
  return Number.isFinite(value) ? value : 0;
}

// The offset of all `translate(...)` transforms from `element` up to the root. Mermaid
// places groups (nodes, subgraph contents, the pie) with translations only.
export function offsetOf(element: Element): { x: number; y: number } {
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

export interface PathSegment {
  // Lowercase command letter.
  readonly command: string;
  // The arguments, with a relative end point already made absolute.
  readonly args: readonly number[];
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
}

// The segments of a path, following relative commands from the pen position.
export function pathSegments(d: string): PathSegment[] {
  const segments: PathSegment[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  for (const [, command = "", rest = ""] of d.matchAll(PATH_COMMAND)) {
    const lower = command.toLowerCase();
    const relative = command === lower;
    const count = PATH_ARGUMENTS[lower] ?? 0;
    const numbers = (rest.match(SVG_NUMBER) ?? []).map(Number);
    if (count === 0) {
      x = startX;
      y = startY;
      continue;
    }
    for (let index = 0; index + count <= numbers.length; index += count) {
      const args = numbers.slice(index, index + count);
      const from = { x, y };
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
      segments.push({ command: lower, args, from, to: { x, y } });
    }
  }
  return segments;
}

// The points a path passes through (the end point of every segment, as x, y pairs).
// Curves bulge a little past these points; for a click target that is close enough.
export function pathPoints(d: string): number[] {
  return pathSegments(d).flatMap(({ to }) => [to.x, to.y]);
}

export function boxOfPoints(values: readonly number[]): DiagramBox | null {
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

// The box of an outline in its own coordinates (before any transform): the rectangle (or a
// label's foreignObject), the extent of a polygon's points or a path's coordinates, or a
// circle's square.
export function localBox(outline: Element): DiagramBox | null {
  const rect =
    outline.localName === "rect" || outline.localName === "foreignObject"
      ? outline
      : null;
  if (rect !== null && numberAttribute(rect, "width") > 0) {
    return {
      x: numberAttribute(rect, "x"),
      y: numberAttribute(rect, "y"),
      width: numberAttribute(rect, "width"),
      height: numberAttribute(rect, "height"),
    };
  }
  if (outline.localName === "polygon") {
    return boxOfPoints(
      (outline.getAttribute("points")?.match(SVG_NUMBER) ?? []).map(Number),
    );
  }
  if (outline.localName === "circle" || outline.localName === "ellipse") {
    const rx = numberAttribute(outline, "r") || numberAttribute(outline, "rx");
    const ry = numberAttribute(outline, "r") || numberAttribute(outline, "ry");
    return {
      x: numberAttribute(outline, "cx") - rx,
      y: numberAttribute(outline, "cy") - ry,
      width: rx * 2,
      height: ry * 2,
    };
  }
  if (outline.localName === "path") {
    return boxOfPoints(pathPoints(outline.getAttribute("d") ?? ""));
  }
  return null;
}

// The box of an outline in diagram coordinates (with every translation above it), or null
// when it has no area.
export function placedBox(outline: Element | null): DiagramBox | null {
  const box = outline === null ? null : localBox(outline);
  if (outline === null || box === null || box.width <= 0 || box.height <= 0) {
    return null;
  }
  const offset = offsetOf(outline);
  return { ...box, x: box.x + offset.x, y: box.y + offset.y };
}

// The points of a `<line>` or a `<path>` in diagram coordinates.
export function placedLinePoints(element: Element): number[] {
  const local =
    element.localName === "line"
      ? [
          numberAttribute(element, "x1"),
          numberAttribute(element, "y1"),
          numberAttribute(element, "x2"),
          numberAttribute(element, "y2"),
        ]
      : pathPoints(element.getAttribute("d") ?? "");
  const offset = offsetOf(element);
  return local.map(
    (value, index) => value + (index % 2 === 0 ? offset.x : offset.y),
  );
}

// "#2859c0", "#abc" and "rgb(40, 89, 192)" as one comparable "r,g,b"; anything else as is.
export function colorKey(color: string): string {
  const text = color.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text)?.[1];
  if (hex !== undefined) {
    const full =
      hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
    return [0, 2, 4]
      .map((start) => Number.parseInt(full.slice(start, start + 2), 16))
      .join(",");
  }
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(text);
  return rgb === null ? text : `${rgb[1]},${rgb[2]},${rgb[3]}`;
}

// The value of one property in a `style` attribute ("fill: red; stroke: blue").
export function styleProperty(element: Element, name: string): string | null {
  for (const declaration of (element.getAttribute("style") ?? "").split(";")) {
    const [property, value] = declaration.split(":");
    if (property?.trim() === name && value !== undefined) return value.trim();
  }
  return null;
}
