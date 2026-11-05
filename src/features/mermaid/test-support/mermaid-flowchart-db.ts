// TEST ONLY. Reads what Mermaid 12.3.0 itself holds after reading a flowchart, through its
// internal diagram API (`mermaid.mermaidAPI.getDiagramFromText(...).db`). That API is not
// public and may change with the library version; nothing in the app uses it. It is the
// independent reference the domain's FlowchartMeaning is compared against. If the shape of
// the db changes, this file throws "internal API changed" instead of comparing nothing.
import mermaid from "mermaid";
import { buildMermaidConfig } from "../mermaid-config";

export type ComparableLabelType = "text" | "markdown";

export interface ComparableNode {
  readonly id: string;
  readonly text: string;
  readonly labelType: ComparableLabelType;
  readonly shape: string | null;
  readonly classes: readonly string[];
  readonly styles: readonly string[];
  readonly hasLink: boolean;
  readonly hasTooltip: boolean;
}

export interface ComparableEdge {
  readonly id: string;
  readonly userDefinedId: boolean;
  readonly start: string;
  readonly end: string;
  readonly type: string;
  readonly stroke: string;
  readonly length: number;
  readonly text: string;
  readonly labelType: ComparableLabelType;
  readonly style: readonly string[] | null;
  readonly interpolate: string | null;
  readonly classes: readonly string[];
  readonly animate: boolean | null;
  readonly animation: string | null;
}

export interface ComparableSubgraph {
  readonly id: string;
  readonly title: string;
  readonly labelType: ComparableLabelType;
  readonly members: readonly string[];
  readonly direction: string | null;
  readonly classes: readonly string[];
}

// The part of FlowchartMeaning that Mermaid's db can also tell: no statement indexes, no
// "implicit node" facts, no label forms.
export interface ComparableMeaning {
  readonly direction: string;
  readonly nodes: readonly ComparableNode[];
  readonly edges: readonly ComparableEdge[];
  readonly subgraphs: readonly ComparableSubgraph[];
  readonly classDefs: readonly {
    readonly name: string;
    readonly styles: readonly string[];
  }[];
  readonly edgeDefaults: {
    readonly style: readonly string[] | null;
    readonly interpolate: string | null;
  };
}

interface DbVertex {
  id: string;
  text?: string;
  type?: string;
  labelType: string;
  classes: string[];
  styles: string[];
  link?: string;
}

interface DbEdge {
  id: string;
  isUserDefinedId: boolean;
  start: string;
  end: string;
  type: string;
  stroke: string;
  length: number;
  text: string;
  labelType: string;
  style?: string[];
  interpolate?: string;
  classes: string[];
  animate?: boolean;
  animation?: string;
}

interface DbSubgraph {
  id: string;
  title: string;
  labelType: string;
  nodes: string[];
  dir?: string;
  classes: string[];
}

type DbEdgeList = DbEdge[] & {
  defaultStyle?: string[];
  defaultInterpolate?: string;
};

interface MermaidFlowDb {
  getVertices(): Map<string, DbVertex>;
  getEdges(): DbEdgeList;
  getSubGraphs(): DbSubgraph[];
  getClasses(): Map<string, { styles: string[] }>;
  getDirection(): string | undefined;
  tooltips: Map<string, string>;
}

const REQUIRED_DB_FUNCTIONS = [
  "getVertices",
  "getEdges",
  "getSubGraphs",
  "getClasses",
  "getDirection",
] as const;

export type MermaidFlowchartReading =
  | { readonly accepted: true; readonly meaning: ComparableMeaning }
  | { readonly accepted: false; readonly message: string };

function assertFlowDb(db: unknown, diagramType: string): MermaidFlowDb {
  const candidate = db as Record<string, unknown>;
  const missing = REQUIRED_DB_FUNCTIONS.filter(
    (name) => typeof candidate[name] !== "function",
  );
  if (missing.length > 0 || !(candidate.tooltips instanceof Map)) {
    throw new Error(
      `mermaid internal API changed: the ${diagramType} db lacks ${[
        ...missing,
        ...(candidate.tooltips instanceof Map ? [] : ["tooltips"]),
      ].join(", ")}`,
    );
  }
  return db as MermaidFlowDb;
}

// Mermaid labels a quoted plain string `string`; the app does not tell it from `text`.
function labelTypeOf(raw: string): ComparableLabelType {
  return raw === "markdown" ? "markdown" : "text";
}

let initialized = false;

export async function readFlowchartWithMermaid(
  source: string,
): Promise<MermaidFlowchartReading> {
  // Same configuration as the app (strict security level, secure keys), so `click`,
  // sanitising and the limits behave as in the preview.
  if (!initialized) {
    mermaid.initialize(buildMermaidConfig({}));
    initialized = true;
  }
  try {
    await mermaid.parse(source);
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
    const db = diagram.db as unknown as Record<string, unknown>;
    if (typeof db.getVertices !== "function") {
      if (/flow/i.test(diagram.type)) assertFlowDb(db, diagram.type);
      return { accepted: false, message: `not a flowchart: ${diagram.type}` };
    }
    const flow = assertFlowDb(db, diagram.type);
    const edges = flow.getEdges();
    return {
      accepted: true,
      meaning: {
        direction: flow.getDirection() ?? "",
        nodes: [...flow.getVertices().values()].map((vertex) => ({
          id: vertex.id,
          text: vertex.text ?? vertex.id,
          labelType: labelTypeOf(vertex.labelType),
          shape: vertex.type ?? null,
          classes: [...vertex.classes],
          styles: vertex.styles.map((style) => style.trim()),
          hasLink: Boolean(vertex.link),
          hasTooltip: flow.tooltips.has(vertex.id),
        })),
        edges: edges.map((edge) => ({
          id: edge.id,
          userDefinedId: edge.isUserDefinedId,
          start: edge.start,
          end: edge.end,
          type: edge.type,
          stroke: edge.stroke,
          length: edge.length,
          text: edge.text,
          labelType: labelTypeOf(edge.labelType),
          style: edge.style?.map((style) => style.trim()) ?? null,
          interpolate: edge.interpolate ?? null,
          classes: [...edge.classes],
          animate: edge.animate ?? null,
          animation: edge.animation ?? null,
        })),
        subgraphs: flow.getSubGraphs().map((subgraph) => ({
          id: subgraph.id,
          title: subgraph.title,
          labelType: labelTypeOf(subgraph.labelType),
          // Mermaid lists the end of an edge before its start; the order is not part of the
          // meaning, so both sides are compared sorted.
          members: [...subgraph.nodes].sort(),
          direction: subgraph.dir ?? null,
          classes: [...subgraph.classes],
        })),
        classDefs: [...flow.getClasses().entries()].map(([name, entry]) => ({
          name,
          styles: entry.styles.map((style) => style.trim()),
        })),
        edgeDefaults: {
          style: edges.defaultStyle?.map((style) => style.trim()) ?? null,
          interpolate: edges.defaultInterpolate ?? null,
        },
      },
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("mermaid internal API")
    ) {
      throw error;
    }
    return {
      accepted: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
