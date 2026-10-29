import type {
  FlowchartDirection,
  FlowchartDirectionToken,
  FlowchartLinkStroke,
  FlowchartLinkType,
} from "./flowchart-config";
import type {
  FlowchartEdgeLabelForm,
  FlowchartLabelType,
} from "./flowchart-types";

// What Mermaid 12.1.0 holds after reading a flowchart (its flow db), derived from the
// recognised statements by replaying Mermaid's own rules (docs/architecture.md §16.15.2).
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
