// What each kind of diagram draws that a click can mean, read from Mermaid's SVG. Mermaid
// marks its elements differently per diagram type, so each type has its own reader; they
// look for classes and attributes no other type uses, so all of them run on any drawing.

import { EMPTY_SUBGRAPH_HIT_HEIGHT } from "../../config/mermaid-preview-config";
import type {
  DiagramHit,
  DiagramLine,
  DiagramShape,
  DiagramWedge,
} from "./diagram-shapes";
import {
  boxOfPoints,
  colorKey,
  type DiagramBox,
  numberAttribute,
  offsetOf,
  pathSegments,
  placedBox,
  placedLinePoints,
  styleProperty,
} from "./diagram-svg-geometry";

export interface DiagramLayers {
  readonly shapes: readonly DiagramShape[];
  readonly wedges: readonly DiagramWedge[];
  readonly lines: readonly DiagramLine[];
  readonly areas: readonly DiagramShape[];
}

const EMPTY: DiagramLayers = { shapes: [], wedges: [], lines: [], areas: [] };

function boxShape(hit: DiagramHit, outline: Element | null): DiagramShape[] {
  const box = placedBox(outline);
  return box === null ? [] : [{ hit, box }];
}

function lineOf(hit: DiagramHit, element: Element): DiagramLine[] {
  const points = placedLinePoints(element);
  return points.length < 4 ? [] : [{ hit, points }];
}

// The part of a Mermaid element id after the drawing's own id (`<svg id>-<id>`).
function ownId(root: Element, element: Element): string | null {
  const prefix = `${root.getAttribute("id") ?? ""}-`;
  const id = element.getAttribute("id") ?? "";
  return prefix.length > 1 && id.startsWith(prefix)
    ? id.slice(prefix.length)
    : null;
}

// Elements in the order of the number in their `data-id` (`i12` -> 12): Mermaid numbers the
// statements of a sequence diagram in source order, though it draws notes first.
function inStatementOrder(elements: Iterable<Element>): Element[] {
  const order = (element: Element) =>
    Number(
      /\d+/.exec(element.getAttribute("data-id") ?? "")?.[0] ?? Number.NaN,
    );
  return [...elements]
    .filter((element) => Number.isFinite(order(element)))
    .sort((first, second) => order(first) - order(second));
}

// ---- flowchart ----

// Mermaid gives each flowchart node `<svg id>-flowchart-<node id>-<counter>`.
const FLOWCHART_NODE_ID = /-flowchart-(.+)-\d+$/;
// Each edge path carries the edge's id as the flowchart source knows it (`L_A_B_0`, or the
// id written with `@`); its label carries the same id.
const EDGE_PATH_SELECTOR = "path[data-edge='true'][data-id]";
const EDGE_LABEL_SELECTOR = "g.edgeLabel [data-id]";
// The node's outline: its rectangle, polygon (diamond, hexagon ...), circle / ellipse, or
// path (stadium, cylinder ...).
const NODE_OUTLINE_SELECTOR =
  "rect.label-container, rect, polygon, circle, ellipse, path";

// An empty subgraph is drawn as its title alone: its rectangle has no height and runs
// through the title. The click target is one label line around it.
function emptySubgraphBox(rect: Element): DiagramBox | null {
  const width = numberAttribute(rect, "width");
  if (!(width > 0) || numberAttribute(rect, "height") !== 0) return null;
  const offset = offsetOf(rect);
  return {
    x: numberAttribute(rect, "x") + offset.x,
    y: numberAttribute(rect, "y") + offset.y - EMPTY_SUBGRAPH_HIT_HEIGHT / 2,
    width,
    height: EMPTY_SUBGRAPH_HIT_HEIGHT,
  };
}

function readFlowchart(root: Element): DiagramLayers {
  const nodes = [...root.querySelectorAll("g.node")].flatMap((node) => {
    const id = FLOWCHART_NODE_ID.exec(node.getAttribute("id") ?? "")?.[1];
    if (id === undefined) return [];
    // Mermaid moves some outlines (the diamond) with a transform of their own inside the
    // node's group, so the offset is taken from the outline up.
    return boxShape(
      { kind: "node", id },
      node.querySelector(NODE_OUTLINE_SELECTOR),
    );
  });
  const edgeLabels = [...root.querySelectorAll(EDGE_LABEL_SELECTOR)].flatMap(
    (label) => {
      const id = label.getAttribute("data-id") ?? "";
      return id === ""
        ? []
        : boxShape(
            { kind: "edge", id },
            label.querySelector("rect, foreignObject"),
          );
    },
  );
  const edges = [...root.querySelectorAll(EDGE_PATH_SELECTOR)].flatMap(
    (path) => {
      const id = path.getAttribute("data-id") ?? "";
      return id === "" ? [] : lineOf({ kind: "edge", id }, path);
    },
  );
  // A subgraph is a group `<svg id>-<subgraph id>` holding its rectangle.
  const subgraphs = [...root.querySelectorAll("g.cluster")].flatMap(
    (cluster): DiagramShape[] => {
      const id = ownId(root, cluster);
      const rect = cluster.querySelector("rect");
      if (id === null || rect === null) return [];
      const box = placedBox(rect) ?? emptySubgraphBox(rect);
      return box === null ? [] : [{ hit: { kind: "subgraph", id }, box }];
    },
  );
  return {
    shapes: [...nodes, ...edgeLabels],
    wedges: [],
    lines: edges,
    areas: subgraphs,
  };
}

// ---- sequence diagram ----

const SEQUENCE_ROLE = "sequence";

// The blocks (loop, alt, opt ... and the coloured rect) as areas, numbered in source order of
// their headers. Mermaid numbers a block by its `end`, so the order comes from the drawing
// instead: a later block starts lower, and a block inside another starts below the outer
// one's top (on a tie the larger, outer block comes first).
function sequenceBlocks(root: Element): DiagramShape[] {
  const framed = [
    ...root.querySelectorAll("g[data-et='control-structure']"),
  ].flatMap((group) => {
    const points = [...group.querySelectorAll("line")].flatMap((line) =>
      placedLinePoints(line),
    );
    const box = boxOfPoints(points);
    return box === null || box.width <= 0 || box.height <= 0 ? [] : [box];
  });
  // `rect.rect` is the coloured block only in a sequence diagram.
  const coloured =
    root.getAttribute("aria-roledescription") === SEQUENCE_ROLE
      ? [...root.querySelectorAll("rect.rect")].flatMap((rect) => {
          const box = placedBox(rect);
          return box === null ? [] : [box];
        })
      : [];
  return [...framed, ...coloured]
    .sort(
      (first, second) =>
        first.y - second.y ||
        second.width * second.height - first.width * first.height,
    )
    .map((box, ordinal) => ({ hit: { kind: "block", id: "", ordinal }, box }));
}

function readSequence(root: Element): DiagramLayers {
  // A participant is drawn at the top and again at the bottom, each box named by its id.
  const boxes = [...root.querySelectorAll("rect.actor[name]")].flatMap((rect) =>
    boxShape(
      { kind: "participant", id: rect.getAttribute("name") ?? "" },
      rect,
    ),
  );
  // An actor (stick figure) has no box: its group is the participant.
  const figures = [
    ...root.querySelectorAll("g[data-et='participant'][data-id]"),
  ].flatMap((group) =>
    group.querySelector("rect.actor") === null
      ? boxShape(
          { kind: "participant", id: group.getAttribute("data-id") ?? "" },
          group.querySelector("circle, rect, path"),
        )
      : [],
  );
  const lifelines = [
    ...root.querySelectorAll("line[data-et='life-line'][data-id]"),
  ].flatMap((line) =>
    lineOf(
      { kind: "participant", id: line.getAttribute("data-id") ?? "" },
      line,
    ),
  );
  const messages = inStatementOrder(
    root.querySelectorAll("[data-et='message'][data-id]"),
  ).flatMap((element, ordinal) =>
    lineOf({ kind: "message", id: "", ordinal }, element),
  );
  const notes = inStatementOrder(
    root.querySelectorAll("[data-et='note'][data-id]"),
  ).flatMap((group, ordinal) =>
    boxShape({ kind: "note", id: "", ordinal }, group.querySelector("rect")),
  );
  return {
    shapes: [...boxes, ...figures, ...notes].filter(
      (shape) => shape.hit.kind !== "participant" || shape.hit.id !== "",
    ),
    wedges: [],
    // Messages first: at the same distance from a message and a lifeline, the message is
    // meant (the nearest line wins otherwise).
    lines: [...messages, ...lifelines.filter((line) => line.hit.id !== "")],
    areas: sequenceBlocks(root),
  };
}

// ---- Gantt chart ----

function readGantt(root: Element): DiagramLayers {
  // Tasks are drawn in source order, each bar `<svg id>-<task id>` (Mermaid makes up an id
  // for a task without one).
  const tasks = [...root.querySelectorAll("rect.task")].flatMap(
    (rect, ordinal) =>
      boxShape({ kind: "task", id: ownId(root, rect) ?? "", ordinal }, rect),
  );
  // Behind each task row is a stripe of its section's colour, one per task in the same
  // order: a click on the row away from the bar means the task's section.
  const rows = [...root.querySelectorAll("rect.section")].flatMap(
    (rect, ordinal) => boxShape({ kind: "section", id: "", ordinal }, rect),
  );
  return { shapes: tasks, wedges: [], lines: [], areas: rows };
}

// ---- pie chart ----

const FULL_TURN = 2 * Math.PI;
// Arc arguments: rx, ry, rotation, large-arc flag, sweep flag, x, y.
const ARC_RADIUS_ARGUMENT = 0;
const ARC_SWEEP_ARGUMENT = 4;

const turnOf = (angle: number) => ((angle % FULL_TURN) + FULL_TURN) % FULL_TURN;

// A slice is a wedge from the pie's centre (its group's origin); its arcs give the angles.
// The legend names the slices: each legend entry has the colour of its slice.
function readPie(root: Element): DiagramLayers {
  const labelOfColor = new Map<string, { label: string; ordinal: number }>();
  const legend = [...root.querySelectorAll("g.legend")].flatMap(
    (entry, ordinal) => {
      const label = entry.querySelector("text")?.textContent ?? "";
      const rect = entry.querySelector("rect");
      const color = rect === null ? null : styleProperty(rect, "fill");
      if (color !== null && !labelOfColor.has(colorKey(color))) {
        labelOfColor.set(colorKey(color), { label, ordinal });
      }
      return boxShape({ kind: "slice", id: label, ordinal }, rect);
    },
  );
  const wedges = [...root.querySelectorAll("path.pieCircle")].flatMap(
    (path): DiagramWedge[] => {
      const named = labelOfColor.get(colorKey(path.getAttribute("fill") ?? ""));
      if (named === undefined) return [];
      const center = offsetOf(path);
      const arcs = pathSegments(path.getAttribute("d") ?? "")
        .filter((segment) => segment.command === "a")
        .map((segment) => {
          const from = Math.atan2(segment.from.y, segment.from.x);
          const to = Math.atan2(segment.to.y, segment.to.x);
          // With y pointing down, sweep 1 runs the way the angle grows.
          const clockwise = segment.args[ARC_SWEEP_ARGUMENT] === 1;
          const start = turnOf(clockwise ? from : to);
          const length = turnOf(clockwise ? to - from : from - to);
          return {
            start,
            length,
            radius: segment.args[ARC_RADIUS_ARGUMENT] ?? 0,
          };
        });
      const radius = Math.max(0, ...arcs.map((arc) => arc.radius));
      if (arcs.length === 0 || radius <= 0) return [];
      return [
        {
          hit: { kind: "slice", id: named.label, ordinal: named.ordinal },
          center,
          radius,
          arcs: arcs.map(({ start, length }) => ({ start, length })),
        },
      ];
    },
  );
  return { shapes: legend, wedges, lines: [], areas: [] };
}

const READERS = [readFlowchart, readSequence, readGantt, readPie];

export function readDiagramLayers(root: Element): DiagramLayers {
  return READERS.map((read) => read(root)).reduce(
    (all, layers) => ({
      shapes: [...all.shapes, ...layers.shapes],
      wedges: [...all.wedges, ...layers.wedges],
      lines: [...all.lines, ...layers.lines],
      areas: [...all.areas, ...layers.areas],
    }),
    EMPTY,
  );
}

export function wedgeContains(
  wedge: DiagramWedge,
  x: number,
  y: number,
): boolean {
  const dx = x - wedge.center.x;
  const dy = y - wedge.center.y;
  if (Math.hypot(dx, dy) > wedge.radius) return false;
  const angle = turnOf(Math.atan2(dy, dx));
  return wedge.arcs.some(
    // A whole circle is two half arcs; a zero length never contains anything.
    (arc) => turnOf(angle - arc.start) <= arc.length,
  );
}
