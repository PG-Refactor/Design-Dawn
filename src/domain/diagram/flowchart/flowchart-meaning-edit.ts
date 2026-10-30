import type {
  FlowchartDirection,
  FlowchartDirectionToken,
} from "./flowchart-config";
import { renumberAutoEdgeIds } from "./flowchart-edge-id";
import type {
  FlowchartEdgeMeaning,
  FlowchartMeaning,
  FlowchartNodeMeaning,
  FlowchartSubgraphMeaning,
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

// Deleting a node takes every edge that starts or ends at it, the node from the members of
// every subgraph, and the ids of the edges that had an id of their own (an `id@{ ... }` line
// inside a block makes the id a member, and the line goes with the edge).
export function withoutNode(
  meaning: FlowchartMeaning,
  nodeId: string,
): FlowchartMeaning {
  const gone = meaning.edges.filter(
    (edge) => edge.start === nodeId || edge.end === nodeId,
  );
  const goneIds = new Set(
    gone.filter((edge) => edge.userDefinedId).map((edge) => edge.id),
  );
  return {
    ...meaning,
    nodes: meaning.nodes.filter((node) => node.id !== nodeId),
    edges: renumberAutoEdgeIds(
      meaning.edges.filter((edge) => !gone.includes(edge)),
    ),
    subgraphs: meaning.subgraphs.map((subgraph) => ({
      ...subgraph,
      members: subgraph.members.filter(
        (member) => member !== nodeId && !goneIds.has(member),
      ),
    })),
  };
}

export function withSubgraph(
  meaning: FlowchartMeaning,
  subgraphId: string,
  patch: Partial<FlowchartSubgraphMeaning>,
): FlowchartMeaning {
  return {
    ...meaning,
    subgraphs: meaning.subgraphs.map((subgraph) =>
      subgraph.id === subgraphId ? { ...subgraph, ...patch } : subgraph,
    ),
  };
}

export function withSubgraphDirection(
  meaning: FlowchartMeaning,
  subgraphId: string,
  direction: FlowchartDirectionToken | null,
): FlowchartMeaning {
  return withSubgraph(meaning, subgraphId, { direction });
}

// Replaces the members of every subgraph by the ones the membership rule gives.
export function withMembers(
  meaning: FlowchartMeaning,
  members: ReadonlyMap<string, readonly string[]>,
): FlowchartMeaning {
  return {
    ...meaning,
    subgraphs: meaning.subgraphs.map((subgraph) => ({
      ...subgraph,
      members: members.get(subgraph.id) ?? subgraph.members,
    })),
  };
}

export function withAppendedSubgraph(
  meaning: FlowchartMeaning,
  subgraph: FlowchartSubgraphMeaning,
): FlowchartMeaning {
  return { ...meaning, subgraphs: [...meaning.subgraphs, subgraph] };
}

export function withoutSubgraph(
  meaning: FlowchartMeaning,
  subgraphId: string,
): FlowchartMeaning {
  return {
    ...meaning,
    subgraphs: meaning.subgraphs.filter(
      (subgraph) => subgraph.id !== subgraphId,
    ),
  };
}

// Nodes are listed in the order of their first mention. When an edit moves the first mention
// of a node (to `position`, a statement number in the old numbering; a half number lies
// between two statements), the node moves with it. Returns null when another node was first
// mentioned in the same statement: the order inside one statement is not modelled.
export function withNodeFirstMention(
  meaning: FlowchartMeaning,
  nodeId: string,
  position: number,
): FlowchartMeaning | null {
  const node = meaning.nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined) return meaning;
  if (node.firstMention.statementIndex === position) return meaning;
  const others = meaning.nodes.filter((candidate) => candidate.id !== nodeId);
  if (others.some((other) => other.firstMention.statementIndex === position)) {
    return null;
  }
  const at = others.findIndex(
    (other) => other.firstMention.statementIndex > position,
  );
  const nodes =
    at === -1
      ? [...others, node]
      : [...others.slice(0, at), node, ...others.slice(at)];
  return { ...meaning, nodes };
}
