import type { FlowchartDirection } from "./flowchart-config";
import { renumberAutoEdgeIds } from "./flowchart-edge-id";
import type {
  FlowchartEdgeMeaning,
  FlowchartMeaning,
  FlowchartNodeMeaning,
} from "./flowchart-meaning";

// "Meaning before + what the operation meant": the expected meaning of an edit, built
// without looking at the text the edit produces. Pure functions on the meaning; the
// operations (flowchart-operations.ts) decide WHICH of these an operation is, and
// `checkFlowchartMeaning` proves that the written text reads back the same.

export function withDirection(
  meaning: FlowchartMeaning,
  direction: FlowchartDirection,
): FlowchartMeaning {
  return { ...meaning, direction };
}

export function withNode(
  meaning: FlowchartMeaning,
  nodeId: string,
  patch: Partial<FlowchartNodeMeaning>,
): FlowchartMeaning {
  return {
    ...meaning,
    nodes: meaning.nodes.map((node) =>
      node.id === nodeId ? { ...node, ...patch } : node,
    ),
  };
}

export function withAppendedNode(
  meaning: FlowchartMeaning,
  node: FlowchartNodeMeaning,
): FlowchartMeaning {
  return { ...meaning, nodes: [...meaning.nodes, node] };
}

// Changing which nodes an edge joins changes the automatic ids of the edges between the same
// nodes (`_0`, `_2` ...), so every automatic id is recomputed in the new order.
export function withEdge(
  meaning: FlowchartMeaning,
  edgeIndex: number,
  patch: Partial<FlowchartEdgeMeaning>,
): FlowchartMeaning {
  return {
    ...meaning,
    edges: renumberAutoEdgeIds(
      meaning.edges.map((edge, index) =>
        index === edgeIndex ? { ...edge, ...patch } : edge,
      ),
    ),
  };
}

export function withAppendedEdge(
  meaning: FlowchartMeaning,
  edge: FlowchartEdgeMeaning,
): FlowchartMeaning {
  return {
    ...meaning,
    edges: renumberAutoEdgeIds([...meaning.edges, edge]),
  };
}

export function withoutEdge(
  meaning: FlowchartMeaning,
  edgeIndex: number,
): FlowchartMeaning {
  return {
    ...meaning,
    edges: renumberAutoEdgeIds(
      meaning.edges.filter((_, index) => index !== edgeIndex),
    ),
  };
}

// Nodes are listed in the order of their first mention. When an edit writes a mention of a
// node earlier than its old first mention (reconnecting an edge to a node that was first
// mentioned further down), that node moves up to the statement. `termIds` are the ids the
// edited statement mentions after the edit, in order; nodes first mentioned before the
// statement keep their place, the rest of the statement's nodes and the moved one come in
// that order, and nodes first mentioned after it follow.
export function withNodesReordered(
  meaning: FlowchartMeaning,
  statementIndex: number,
  termIds: readonly string[],
): FlowchartMeaning {
  const before = meaning.nodes.filter(
    (node) => node.firstMention.statementIndex < statementIndex,
  );
  const placed = new Set(before.map((node) => node.id));
  const byId = new Map(meaning.nodes.map((node) => [node.id, node]));
  const inStatement: FlowchartNodeMeaning[] = [];
  for (const id of termIds) {
    const node = byId.get(id);
    if (node === undefined || placed.has(id)) continue;
    placed.add(id);
    inStatement.push(node);
  }
  const rest = meaning.nodes.filter((node) => !placed.has(node.id));
  return { ...meaning, nodes: [...before, ...inStatement, ...rest] };
}
