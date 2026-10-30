import type {
  FlowchartDirection,
  FlowchartLinkStroke,
  FlowchartLinkType,
} from "./flowchart-config";
import { normalizeFlowchartDirection } from "./flowchart-config";
import { decodeFlowchartLabel } from "./flowchart-label-text";
import { prepareFlowchart, resolveEdge } from "./flowchart-operation-support";
import {
  type FlowchartOperation,
  nodeEditRestriction,
  planFlowchartOperation,
} from "./flowchart-operations";
import { ownerOf } from "./flowchart-subgraph-model";

// What the flowchart GUI shows of an editable flowchart. Read-only and derived from the
// source on every call, so the GUI never holds a model of its own that could drift from the
// text (the same rule as PieChartView).

// Why an element cannot be edited (the first word of the refusal the operation would give),
// or null. A view marks the controls unavailable with this reason instead of letting the
// user try.
export interface FlowchartNodeView {
  readonly id: string;
  // What a person reads and edits (entities and `<br/>` shown as the characters they stand
  // for). The id itself for a node that never got a label.
  readonly displayLabel: string;
  // The db shape name, or null for a node that was never given one (drawn as a rectangle).
  readonly shape: string | null;
  readonly restriction: string | null;
  // The subgraph the node is a member of (the one that closes first among those that write
  // it), or null.
  readonly ownerId: string | null;
}

export interface FlowchartEdgeView {
  // Position in Mermaid's edge order and the edge's id: both are sent back as the target.
  readonly index: number;
  readonly id: string;
  readonly start: string;
  readonly end: string;
  readonly startLabel: string;
  readonly endLabel: string;
  // Empty when the edge has no label.
  readonly displayLabel: string;
  readonly type: FlowchartLinkType;
  readonly stroke: FlowchartLinkStroke;
  readonly length: number;
  // Stops every operation on the edge (an `&` list, no written link).
  readonly restriction: string | null;
  // Stops only the label (a markdown label).
  readonly labelRestriction: string | null;
  // Only the outer ends of a chain `A --> B --> C` belong to one edge.
  readonly canReconnectStart: boolean;
  readonly canReconnectEnd: boolean;
}

export interface FlowchartSubgraphView {
  readonly id: string;
  readonly title: string;
  readonly memberLabels: readonly string[];
  // The direction line of the block, or null when it has none.
  readonly direction: FlowchartDirection | null;
  // Why the block cannot be dissolved (the reason code the operation would give), or null.
  readonly dissolveRestriction: string | null;
}

// What can be done with one node beyond editing its text. Computed by planning each
// operation, so a control is marked unavailable for exactly the reason the operation gives.
export interface FlowchartNodeActions {
  readonly ownerId: string | null;
  // Edges that start or end at the node: they go with it when it is deleted.
  readonly edgeCount: number;
  readonly deleteRestriction: string | null;
  // By subgraph id: null when the node can be put there (or already is).
  readonly moveRestrictions: Readonly<Record<string, string | null>>;
  // Taking the node out of the subgraph that owns it; null when it has none.
  readonly removeRestriction: string | null;
}

export interface FlowchartView {
  readonly direction: FlowchartDirection;
  readonly nodes: readonly FlowchartNodeView[];
  readonly edges: readonly FlowchartEdgeView[];
  readonly subgraphs: readonly FlowchartSubgraphView[];
}

const MARKDOWN_LABEL_RESTRICTION = "markdownLabel";

// The reason code of the refusal an operation would get, or null when it would be planned.
function restrictionOf(
  source: string,
  operation: FlowchartOperation,
): string | null {
  const plan = planFlowchartOperation(source, operation);
  return plan.ok ? null : (plan.error.detail.split(":")[0]?.trim() ?? null);
}

// Null when the text is not an editable flowchart (the GUI shows the reason instead).
export function readFlowchartView(source: string): FlowchartView | null {
  const prepared = prepareFlowchart(source);
  if (!prepared.ok) return null;
  const { meaning } = prepared.value;
  const labelOf = new Map(
    meaning.nodes.map((node) => [node.id, decodeFlowchartLabel(node.text)]),
  );
  const displayOf = (id: string): string => labelOf.get(id) ?? id;
  const members = new Map(
    meaning.subgraphs.map((subgraph) => [subgraph.id, subgraph.members]),
  );
  return {
    direction: meaning.direction,
    nodes: meaning.nodes.map((node) => ({
      id: node.id,
      displayLabel: displayOf(node.id),
      shape: node.shape,
      restriction: nodeEditRestriction(prepared.value, node.id),
      ownerId: ownerOf(members, node.id),
    })),
    edges: meaning.edges.map((edge, index) => {
      const resolved = resolveEdge(prepared.value, { index, id: edge.id });
      const restriction = resolved.ok
        ? null
        : (resolved.error.detail.split(":")[0]?.trim() ?? null);
      const links =
        resolved.ok && resolved.value.statement.kind === "edge"
          ? resolved.value.statement.links
          : [];
      const linkIndex = resolved.ok ? resolved.value.linkIndex : 0;
      return {
        index,
        id: edge.id,
        start: edge.start,
        end: edge.end,
        startLabel: displayOf(edge.start),
        endLabel: displayOf(edge.end),
        displayLabel: decodeFlowchartLabel(edge.text),
        type: edge.type,
        stroke: edge.stroke,
        length: edge.length,
        restriction,
        labelRestriction:
          resolved.ok &&
          resolved.value.link.label?.label.labelType === "markdown"
            ? MARKDOWN_LABEL_RESTRICTION
            : null,
        canReconnectStart: restriction === null && linkIndex === 0,
        canReconnectEnd:
          restriction === null &&
          links.length > 0 &&
          linkIndex === links.length - 1,
      };
    }),
    subgraphs: meaning.subgraphs.map((subgraph) => ({
      id: subgraph.id,
      title: decodeFlowchartLabel(subgraph.title),
      memberLabels: subgraph.members.map(displayOf),
      direction:
        subgraph.direction === null
          ? null
          : normalizeFlowchartDirection(subgraph.direction),
      dissolveRestriction: restrictionOf(source, {
        kind: "dissolveSubgraph",
        subgraphId: subgraph.id,
      }),
    })),
  };
}

// Null when the text is not an editable flowchart or has no such node.
export function readFlowchartNodeActions(
  source: string,
  nodeId: string,
): FlowchartNodeActions | null {
  const prepared = prepareFlowchart(source);
  if (!prepared.ok) return null;
  const { meaning } = prepared.value;
  if (!meaning.nodes.some((node) => node.id === nodeId)) return null;
  const ownerId = ownerOf(
    new Map(
      meaning.subgraphs.map((subgraph) => [subgraph.id, subgraph.members]),
    ),
    nodeId,
  );
  return {
    ownerId,
    edgeCount: meaning.edges.filter(
      (edge) => edge.start === nodeId || edge.end === nodeId,
    ).length,
    deleteRestriction: restrictionOf(source, { kind: "deleteNode", nodeId }),
    moveRestrictions: Object.fromEntries(
      meaning.subgraphs.map((subgraph) => [
        subgraph.id,
        restrictionOf(source, {
          kind: "moveNodeToSubgraph",
          nodeId,
          subgraphId: subgraph.id,
        }),
      ]),
    ),
    removeRestriction:
      ownerId === null
        ? null
        : restrictionOf(source, {
            kind: "removeNodeFromSubgraph",
            nodeId,
            subgraphId: ownerId,
          }),
  };
}
