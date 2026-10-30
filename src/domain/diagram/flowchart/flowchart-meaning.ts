import { type DomainResult, err, ok } from "../../shared/domain-result";
import type {
  FlowchartDirection,
  FlowchartDirectionToken,
  FlowchartLinkStroke,
  FlowchartLinkType,
} from "./flowchart-config";
import { flowchartEditability } from "./flowchart-editability";
import type { FlowchartReading } from "./flowchart-reader";
import type {
  FlowchartEdgeLabelForm,
  FlowchartLabelType,
} from "./flowchart-types";

// What Mermaid 12.1.0 holds after reading a flowchart (its flow db), derived from the
// recognised statements by replaying Mermaid's own rules.
// It is built only when the whole text was understood: never a partial meaning.
// Texts are compared with Mermaid's own only when they contain none of `<>&#`, backticks or
// backslashes, because Mermaid rewrites those (flowchart-reader.real.dom.test.ts).

// How a node first came to exist. A node whose first mention is a bare id or an edge
// endpoint, and that never got a label or a shape, is an "implicit node".
export type FlowchartFirstMentionOrigin =
  | "bareNode"
  | "edgeEndpoint"
  | "definition"
  | "styleStatement";

export interface FlowchartNodeMeaning {
  readonly id: string;
  // The id itself until a label is given.
  readonly text: string;
  readonly labelType: FlowchartLabelType;
  // The db type name of a bracket shape (`square`, `round` ...) or the `@{ shape }` name;
  // null when the node was never given one (Mermaid draws a rectangle).
  readonly shape: string | null;
  readonly classes: readonly string[];
  readonly styles: readonly string[];
  readonly hasLink: boolean;
  readonly hasTooltip: boolean;
  // True once a bracket label or an `@{ label }` has been written for the node.
  readonly explicitLabel: boolean;
  readonly firstMention: {
    readonly statementIndex: number;
    readonly origin: FlowchartFirstMentionOrigin;
  };
}

export interface FlowchartEdgeMeaning {
  // Mermaid's id: the user's `e1@` or `L_<start>_<end>_<n>`.
  readonly id: string;
  readonly userDefinedId: boolean;
  readonly start: string;
  readonly end: string;
  readonly type: FlowchartLinkType;
  readonly stroke: FlowchartLinkStroke;
  readonly length: number;
  readonly text: string;
  readonly labelType: FlowchartLabelType;
  // null when the label is written in no particular form (no label).
  readonly labelForm: FlowchartEdgeLabelForm | null;
  readonly style: readonly string[] | null;
  readonly interpolate: string | null;
  readonly classes: readonly string[];
  readonly animate: boolean | null;
  readonly animation: string | null;
  // The edge statement that created the edge and the link inside it (links[linkIndex]).
  readonly statementIndex: number;
  readonly linkIndex: number;
  // True when the link joins `A & B` lists: several edges come from one written link.
  readonly sharedByAmpersand: boolean;
}

export interface FlowchartSubgraphMeaning {
  readonly id: string;
  // The id when no title is written.
  readonly title: string;
  readonly labelType: FlowchartLabelType;
  // Resolved by Mermaid's rule "the first definition wins": a node that already belongs to
  // an earlier registered subgraph is dropped here. Nested subgraph ids are members too.
  readonly members: readonly string[];
  // As written (Mermaid keeps `TD` in a subgraph, while it normalises the header's).
  readonly direction: FlowchartDirectionToken | null;
  readonly classes: readonly string[];
  readonly statementIndex: number;
}

export interface FlowchartClassDefMeaning {
  readonly name: string;
  // A second `classDef` of the same name appends.
  readonly styles: readonly string[];
}

export interface FlowchartMeaning {
  readonly direction: FlowchartDirection;
  // In order of first mention.
  readonly nodes: readonly FlowchartNodeMeaning[];
  // In Mermaid's order, which is the linkStyle index.
  readonly edges: readonly FlowchartEdgeMeaning[];
  // In the order Mermaid registers them: when they close, inner before outer.
  readonly subgraphs: readonly FlowchartSubgraphMeaning[];
  readonly classDefs: readonly FlowchartClassDefMeaning[];
  readonly edgeDefaults: {
    readonly style: readonly string[] | null;
    readonly interpolate: string | null;
  };
}

// What is compared, and what is not. Compared: everything Mermaid itself holds (the fields of
// the comparison shape in test-support/flowchart-meaning-comparison.ts), nodes and edges IN
// ORDER (the order of the nodes is the order of their first mention, which the layout may
// follow, and the order of the edges is the `linkStyle` index), and subgraph members as a
// SET (their order is the order of mention, which no edit is promised to keep). Texts are
// compared exactly as the reader stores them. Not compared, because they describe where
// something is written and every edit moves them: `statementIndex`, `linkIndex`,
// `firstMention`, `sharedByAmpersand`, `labelForm` and `explicitLabel`.
function describeDifferences(
  actual: FlowchartMeaning,
  expected: FlowchartMeaning,
): readonly string[] {
  const differences: string[] = [];
  const compare = (what: string, got: unknown, want: unknown) => {
    const gotText = JSON.stringify(got);
    const wantText = JSON.stringify(want);
    if (gotText !== wantText) {
      differences.push(
        `${what}: expected ${wantText.slice(0, DIFFERENCE_TEXT_LIMIT)}, got ${gotText.slice(0, DIFFERENCE_TEXT_LIMIT)}`,
      );
    }
  };
  compare("direction", actual.direction, expected.direction);
  compare("node count", actual.nodes.length, expected.nodes.length);
  const sharedNodes = Math.min(actual.nodes.length, expected.nodes.length);
  for (let index = 0; index < sharedNodes; index += 1) {
    const got = actual.nodes[index] as FlowchartNodeMeaning;
    const want = expected.nodes[index] as FlowchartNodeMeaning;
    compare(`node ${index}`, comparableNode(got), comparableNode(want));
  }
  compare("edge count", actual.edges.length, expected.edges.length);
  const sharedEdges = Math.min(actual.edges.length, expected.edges.length);
  for (let index = 0; index < sharedEdges; index += 1) {
    const got = actual.edges[index] as FlowchartEdgeMeaning;
    const want = expected.edges[index] as FlowchartEdgeMeaning;
    compare(`edge ${index}`, comparableEdge(got), comparableEdge(want));
  }
  compare(
    "subgraphs",
    actual.subgraphs.map(comparableSubgraph),
    expected.subgraphs.map(comparableSubgraph),
  );
  compare("classDefs", actual.classDefs, expected.classDefs);
  compare("edgeDefaults", actual.edgeDefaults, expected.edgeDefaults);
  return differences;
}

const DIFFERENCE_TEXT_LIMIT = 300;

function comparableNode(node: FlowchartNodeMeaning) {
  return {
    id: node.id,
    text: node.text,
    labelType: node.labelType,
    shape: node.shape,
    classes: node.classes,
    styles: node.styles,
    hasLink: node.hasLink,
    hasTooltip: node.hasTooltip,
  };
}

function comparableEdge(edge: FlowchartEdgeMeaning) {
  return {
    id: edge.id,
    userDefinedId: edge.userDefinedId,
    start: edge.start,
    end: edge.end,
    type: edge.type,
    stroke: edge.stroke,
    length: edge.length,
    text: edge.text,
    labelType: edge.labelType,
    style: edge.style,
    interpolate: edge.interpolate,
    classes: edge.classes,
    animate: edge.animate,
    animation: edge.animation,
  };
}

function comparableSubgraph(subgraph: FlowchartSubgraphMeaning) {
  return {
    id: subgraph.id,
    title: subgraph.title,
    labelType: subgraph.labelType,
    members: [...subgraph.members].sort(),
    direction: subgraph.direction,
    classes: subgraph.classes,
  };
}

// Compares the meaning of a candidate with what the operation promised. A candidate that is
// not editable (it has a statement the reader cannot read, a phantom node, more than 500
// edges or 50000 characters ...) is rejected first: an unreadable line might mean anything.
export function checkFlowchartMeaning(
  candidate: FlowchartReading,
  expected: FlowchartMeaning,
): DomainResult<void> {
  const editability = flowchartEditability(candidate);
  if (!editability.editable) {
    return err(
      "diagramNotEditable",
      `candidate ${editability.reason}: ${editability.detail}`,
    );
  }
  if (candidate.meaning === null) {
    return err(
      "diagramNotEditable",
      "candidate meaning: the meaning of the text could not be established",
    );
  }
  const differences = describeDifferences(candidate.meaning, expected);
  return differences.length === 0
    ? ok(undefined)
    : err(
        "diagramMeaningMismatch",
        `meaningMismatch: ${differences.join("; ")}`,
      );
}
