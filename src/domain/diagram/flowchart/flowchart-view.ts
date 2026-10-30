import type {
  FlowchartDirection,
  FlowchartLinkStroke,
  FlowchartLinkType,
} from "./flowchart-config";
import { decodeFlowchartLabel } from "./flowchart-label-text";
import { prepareFlowchart, resolveEdge } from "./flowchart-operation-support";
import { nodeEditRestriction } from "./flowchart-operations";

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
}

export interface FlowchartView {
  readonly direction: FlowchartDirection;
  readonly nodes: readonly FlowchartNodeView[];
  readonly edges: readonly FlowchartEdgeView[];
  readonly subgraphs: readonly FlowchartSubgraphView[];
}

const MARKDOWN_LABEL_RESTRICTION = "markdownLabel";

// Null when the text is not an editable flowchart (the GUI shows the reason instead).
export function readFlowchartView(source: string): FlowchartView | null {
  const prepared = prepareFlowchart(source);
  if (!prepared.ok) return null;
  const { meaning } = prepared.value;
  const labelOf = new Map(
    meaning.nodes.map((node) => [node.id, decodeFlowchartLabel(node.text)]),
  );
  const displayOf = (id: string): string => labelOf.get(id) ?? id;
  return {
    direction: meaning.direction,
    nodes: meaning.nodes.map((node) => ({
      id: node.id,
      displayLabel: displayOf(node.id),
      shape: node.shape,
      restriction: nodeEditRestriction(prepared.value, node.id),
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
    })),
  };
}
