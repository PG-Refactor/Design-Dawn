import type { FlowchartEdgeMeaning } from "./flowchart-meaning";

// Mermaid names an edge `L_<start>_<end>_<n>`, where n is 0 for the first edge between two
// nodes and "number of earlier edges between them + 1" after that (so the second is `_2`;
// measured). The resolver and the operations share this rule
// so an edit that moves or removes an edge predicts the new ids exactly.
export const FLOWCHART_AUTO_EDGE_ID_PREFIX = "L";
const AUTO_EDGE_ID_SEPARATOR = "_";

export function autoEdgeId(
  start: string,
  end: string,
  earlierEdgesBetween: number,
): string {
  const number = earlierEdgesBetween === 0 ? 0 : earlierEdgesBetween + 1;
  return [FLOWCHART_AUTO_EDGE_ID_PREFIX, start, end, number].join(
    AUTO_EDGE_ID_SEPARATOR,
  );
}

// Gives every edge without an id of its own the id Mermaid would give it in this order.
export function renumberAutoEdgeIds(
  edges: readonly FlowchartEdgeMeaning[],
): readonly FlowchartEdgeMeaning[] {
  return edges.map((edge, position) => {
    if (edge.userDefinedId) return edge;
    const earlier = edges
      .slice(0, position)
      .filter(
        (other) => other.start === edge.start && other.end === edge.end,
      ).length;
    return { ...edge, id: autoEdgeId(edge.start, edge.end, earlier) };
  });
}
