import {
  FLOWCHART_AT_BLOCK_DEFAULT_LABEL_TYPE,
  FLOWCHART_AT_BLOCK_EDGE_KEYS,
  FLOWCHART_AT_BLOCK_LABEL_TYPES,
  FLOWCHART_AT_BLOCK_NODE_KEYS,
  FLOWCHART_AT_BLOCK_WORD_VALUE_PATTERN,
  FLOWCHART_CLICKABLE_CLASS,
  FLOWCHART_KNOWN_SHAPE_NAMES,
  FLOWCHART_LINK_STYLE_FILL_DEFAULT,
  FLOWCHART_LINK_STYLE_FILL_PREFIX,
  type FlowchartDirection,
} from "./flowchart-config";
import { autoEdgeId } from "./flowchart-edge-id";
import type {
  FlowchartEdgeMeaning,
  FlowchartFirstMentionOrigin,
  FlowchartMeaning,
  FlowchartNodeMeaning,
  FlowchartSubgraphMeaning,
} from "./flowchart-meaning";
import type {
  PendingStatement,
  StraySeparator,
} from "./flowchart-statement-parser";
import type {
  FlowchartAtBlock,
  FlowchartEdgeAttributeEntry,
  FlowchartEdgeAttributesStatement,
  FlowchartLabelType,
  FlowchartLink,
  FlowchartNodeTerm,
  FlowchartOpaqueReason,
  FlowchartStatement,
  FlowchartSubgraphStartStatement,
  FlowchartVertexStatement,
} from "./flowchart-types";

// Replays the recognised statements in order the way Mermaid's flow db does, to (a) refuse
// what depends on context the single-statement parsers cannot see (an edge id that already
// exists, a subgraph that is not closed, a linkStyle index past the last edge ...) and
// (b) build the meaning. The rules are the ones measured against Mermaid itself.

export interface ResolverRefusal {
  readonly pending: PendingStatement | StraySeparator;
  readonly reason: FlowchartOpaqueReason;
}

export interface Resolution {
  readonly statements: readonly FlowchartStatement[];
  readonly refusals: readonly ResolverRefusal[];
  readonly meaning: FlowchartMeaning | null;
  readonly edgeCount: number;
  // Declared `e1@` ids in source order, one entry per use (also repeated or refused ones).
  readonly declaredEdgeIds: readonly string[];
}

interface MutableNode {
  id: string;
  text: string;
  labelType: FlowchartLabelType;
  shape: string | null;
  classes: string[];
  styles: string[];
  hasLink: boolean;
  explicitLabel: boolean;
  firstMention: {
    statementIndex: number;
    origin: FlowchartFirstMentionOrigin;
  };
}

interface MutableEdge {
  id: string;
  userDefinedId: boolean;
  start: string;
  end: string;
  type: FlowchartEdgeMeaning["type"];
  stroke: FlowchartEdgeMeaning["stroke"];
  length: number;
  text: string;
  labelType: FlowchartLabelType;
  labelForm: FlowchartEdgeMeaning["labelForm"];
  style: string[] | null;
  interpolate: string | null;
  classes: string[];
  animate: boolean | null;
  animation: string | null;
  statementIndex: number;
  linkIndex: number;
  sharedByAmpersand: boolean;
}

interface OpenSubgraph {
  readonly statement: FlowchartSubgraphStartStatement;
  readonly outputPosition: number;
  readonly members: string[];
  direction: FlowchartSubgraphMeaning["direction"];
}

interface MutableSubgraph {
  id: string;
  title: string;
  labelType: FlowchartLabelType;
  members: string[];
  direction: FlowchartSubgraphMeaning["direction"];
  classes: string[];
  statementIndex: number;
}

type Verdict = FlowchartOpaqueReason | null;

const TRUE_LITERAL = "true";
const FALSE_LITERAL = "false";
const NULL_LITERAL = "null";

function isNodeKey(key: string): boolean {
  return (FLOWCHART_AT_BLOCK_NODE_KEYS as readonly string[]).includes(key);
}

function isEdgeKey(key: string): key is FlowchartEdgeAttributeEntry["key"] {
  return (FLOWCHART_AT_BLOCK_EDGE_KEYS as readonly string[]).includes(key);
}

// Checks the keys and values of an `@{}` block used for a node; returns what it sets.
function checkNodeAtBlock(block: FlowchartAtBlock):
  | {
      readonly ok: true;
      readonly shape: string | null;
      readonly label: string | null;
      readonly labelType: FlowchartLabelType;
    }
  | { readonly ok: false; readonly reason: FlowchartOpaqueReason } {
  let shape: string | null = null;
  let label: string | null = null;
  let labelType: FlowchartLabelType = FLOWCHART_AT_BLOCK_DEFAULT_LABEL_TYPE;
  for (const entry of block.entries) {
    const key = entry.key.text;
    if (!isNodeKey(key)) return { ok: false, reason: "atBlockUnsupportedKey" };
    if (key === "shape") {
      if (entry.quoted) return { ok: false, reason: "atBlockUnsupportedValue" };
      if (!FLOWCHART_KNOWN_SHAPE_NAMES.has(entry.value.text)) {
        return { ok: false, reason: "unknownShape" };
      }
      shape = entry.value.text;
    } else if (key === "label") {
      if (!entry.quoted)
        return { ok: false, reason: "atBlockUnsupportedValue" };
      label = entry.value.text;
    } else {
      const known = (
        FLOWCHART_AT_BLOCK_LABEL_TYPES as readonly string[]
      ).includes(entry.value.text);
      if (entry.quoted || !known) {
        return { ok: false, reason: "atBlockUnsupportedValue" };
      }
      labelType = entry.value.text as FlowchartLabelType;
    }
  }
  return { ok: true, shape, label, labelType };
}

function checkEdgeAtBlock(block: FlowchartAtBlock):
  | {
      readonly ok: true;
      readonly entries: readonly FlowchartEdgeAttributeEntry[];
    }
  | { readonly ok: false; readonly reason: FlowchartOpaqueReason } {
  const entries: FlowchartEdgeAttributeEntry[] = [];
  for (const entry of block.entries) {
    const key = entry.key.text;
    if (!isEdgeKey(key)) {
      return { ok: false, reason: "atBlockUnsupportedKey" };
    }
    if (entry.quoted) return { ok: false, reason: "atBlockUnsupportedValue" };
    const value = entry.value.text;
    if (key === "animate") {
      if (value !== TRUE_LITERAL && value !== FALSE_LITERAL) {
        return { ok: false, reason: "atBlockUnsupportedValue" };
      }
    } else if (
      !FLOWCHART_AT_BLOCK_WORD_VALUE_PATTERN.test(value) ||
      value === TRUE_LITERAL ||
      value === FALSE_LITERAL ||
      value === NULL_LITERAL
    ) {
      // A YAML scalar that looks like a boolean, null or number is not a string.
      return { ok: false, reason: "atBlockUnsupportedValue" };
    }
    entries.push({ key, value });
  }
  return { ok: true, entries };
}

export function resolveFlowchart(
  pendingStatements: readonly (PendingStatement | StraySeparator)[],
  direction: FlowchartDirection,
): Resolution {
  const nodes = new Map<string, MutableNode>();
  const edges: MutableEdge[] = [];
  const edgeById = new Map<string, MutableEdge>();
  const classDefs = new Map<string, string[]>();
  const registered: MutableSubgraph[] = [];
  const registeredById = new Map<string, MutableSubgraph>();
  const openSubgraphs: OpenSubgraph[] = [];
  const tooltipIds = new Set<string>();
  const declaredEdgeIds: string[] = [];
  const refusals: ResolverRefusal[] = [];
  const output: (FlowchartStatement | null)[] = [];
  let defaultInterpolate: string | null = null;
  let defaultStyle: string[] | null = null;

  const refuse = (pending: PendingStatement, reason: FlowchartOpaqueReason) => {
    refusals.push({ pending, reason });
    output.push(null);
  };

  const pushMember = (id: string) => {
    openSubgraphs[openSubgraphs.length - 1]?.members.push(id);
  };

  const declareNode = (
    term: FlowchartNodeTerm,
    statementIndex: number,
    origin: FlowchartFirstMentionOrigin,
  ): Verdict => {
    const id = term.id.text;
    // Mermaid ignores a node statement whose id is an edge id: no vertex is made.
    if (edgeById.has(id)) return "edgeIdSwallowsNode";
    let shape: string | null = null;
    let label: string | null = null;
    let atLabelType: FlowchartLabelType = FLOWCHART_AT_BLOCK_DEFAULT_LABEL_TYPE;
    if (term.atBlock !== null) {
      // `@{}` on a closed subgraph's id edits the subgraph, not a node.
      if (registeredById.has(id)) return "atBlockOnSubgraph";
      const checked = checkNodeAtBlock(term.atBlock);
      if (!checked.ok) return checked.reason;
      shape = checked.shape;
      label = checked.label;
      atLabelType = checked.labelType;
    }
    let node = nodes.get(id);
    if (node === undefined) {
      node = {
        id,
        text: id,
        labelType: "text",
        shape: null,
        classes: [],
        styles: [],
        hasLink: false,
        explicitLabel: false,
        firstMention: {
          statementIndex,
          origin:
            term.shape !== null || term.atBlock !== null
              ? "definition"
              : origin,
        },
      };
      nodes.set(id, node);
    }
    if (term.shape !== null) {
      node.text = term.shape.label.value;
      node.labelType = term.shape.label.labelType;
      node.shape = term.shape.shape;
      node.explicitLabel = true;
    }
    if (term.classOperator !== null) {
      node.classes.push(term.classOperator.name.text);
    }
    if (term.atBlock !== null) {
      if (shape !== null) node.shape = shape;
      if (label !== null) {
        node.text = label;
        node.labelType = atLabelType;
        node.explicitLabel = true;
      }
    }
    return null;
  };

  const addEdges = (
    starts: readonly FlowchartNodeTerm[],
    ends: readonly FlowchartNodeTerm[],
    link: FlowchartLink,
    statementIndex: number,
    linkIndex: number,
  ) => {
    const lastStart = starts[starts.length - 1]?.id.text;
    const firstEnd = ends[0]?.id.text;
    const shared = starts.length > 1 || ends.length > 1;
    for (const start of starts) {
      for (const end of ends) {
        const isLastStart = start.id.text === lastStart;
        const isFirstEnd = end.id.text === firstEnd;
        const declared =
          isLastStart && isFirstEnd && link.edgeId !== null
            ? link.edgeId.text
            : null;
        let id: string;
        let userDefinedId = false;
        if (declared !== null && !edgeById.has(declared)) {
          id = declared;
          userDefinedId = true;
        } else {
          const same = edges.filter(
            (edge) => edge.start === start.id.text && edge.end === end.id.text,
          ).length;
          id = autoEdgeId(start.id.text, end.id.text, same);
        }
        const edge: MutableEdge = {
          id,
          userDefinedId,
          start: start.id.text,
          end: end.id.text,
          type: link.type,
          stroke: link.stroke,
          length: link.length,
          text: link.label?.label.value ?? "",
          labelType: link.label?.label.labelType ?? "text",
          labelForm: link.label?.form ?? null,
          style: null,
          interpolate: defaultInterpolate,
          classes: [],
          animate: null,
          animation: null,
          statementIndex,
          linkIndex,
          sharedByAmpersand: shared,
        };
        edges.push(edge);
        if (!edgeById.has(id)) edgeById.set(id, edge);
      }
    }
  };

  const resolveVertexStatement = (
    pending: FlowchartVertexStatementShape,
    statementIndex: number,
  ): Verdict | FlowchartEdgeAttributesStatement => {
    const [onlyGroup] = pending.groups;
    const onlyTerm = onlyGroup?.terms[0];
    if (
      pending.kind === "node" &&
      pending.groups.length === 1 &&
      onlyGroup?.terms.length === 1 &&
      onlyTerm !== undefined &&
      onlyTerm.atBlock !== null &&
      onlyTerm.shape === null &&
      onlyTerm.classOperator === null &&
      edgeById.has(onlyTerm.id.text)
    ) {
      const checked = checkEdgeAtBlock(onlyTerm.atBlock);
      if (!checked.ok) return checked.reason;
      const edge = edgeById.get(onlyTerm.id.text) as MutableEdge;
      for (const entry of checked.entries) {
        if (entry.key === "animate")
          edge.animate = entry.value === TRUE_LITERAL;
        else if (entry.key === "animation") edge.animation = entry.value;
        else edge.interpolate = entry.value;
      }
      // Mermaid lists the id among the subgraph's nodes although no vertex exists.
      pushMember(onlyTerm.id.text);
      return {
        kind: "edgeAttributes",
        lineIndex: pending.lineIndex,
        index: statementIndex,
        text: pending.text,
        span: pending.span,
        id: onlyTerm.id,
        atBlock: onlyTerm.atBlock,
        entries: checked.entries,
      };
    }
    for (const link of pending.links) {
      if (link.edgeId !== null) declaredEdgeIds.push(link.edgeId.text);
    }
    const origin: FlowchartFirstMentionOrigin =
      pending.kind === "edge" ? "edgeEndpoint" : "bareNode";
    for (
      let groupIndex = 0;
      groupIndex < pending.groups.length;
      groupIndex += 1
    ) {
      const group = pending.groups[groupIndex];
      if (group === undefined) continue;
      for (const term of group.terms) {
        const verdict = declareNode(term, statementIndex, origin);
        if (verdict !== null) return verdict;
        pushMember(term.id.text);
      }
      const link = pending.links[groupIndex - 1];
      const previous = pending.groups[groupIndex - 1];
      if (link !== undefined && previous !== undefined) {
        addEdges(
          previous.terms,
          group.terms,
          link,
          statementIndex,
          groupIndex - 1,
        );
      }
    }
    return null;
  };

  for (const pending of pendingStatements) {
    if (pending.kind === "straySeparator") {
      // Mermaid lists the stray `;` as a member of the enclosing subgraph.
      if (openSubgraphs.length > 0) {
        refusals.push({ pending, reason: "strayStatementSeparator" });
      }
      continue;
    }
    const statementIndex = output.length;
    const withIndex = (statement: PendingStatement): FlowchartStatement =>
      ({ ...statement, index: statementIndex }) as FlowchartStatement;

    switch (pending.kind) {
      case "node":
      case "edge": {
        const outcome = resolveVertexStatement(pending, statementIndex);
        if (outcome === null) output.push(withIndex(pending));
        else if (typeof outcome === "string") refuse(pending, outcome);
        else output.push(outcome);
        break;
      }
      case "subgraphStart": {
        const id = pending.id.text;
        if (
          registeredById.has(id) ||
          openSubgraphs.some((open) => open.statement.id.text === id)
        ) {
          refuse(pending, "duplicateSubgraphId");
          break;
        }
        const statement = withIndex(pending) as FlowchartSubgraphStartStatement;
        openSubgraphs.push({
          statement,
          outputPosition: output.length,
          members: [],
          direction: null,
        });
        output.push(statement);
        break;
      }
      case "subgraphDirection": {
        const open = openSubgraphs[openSubgraphs.length - 1];
        if (open === undefined) {
          refuse(pending, "topLevelDirection");
        } else if (open.direction !== null) {
          refuse(pending, "duplicateSubgraphDirection");
        } else {
          open.direction = pending.value;
          output.push(withIndex(pending));
        }
        break;
      }
      case "subgraphEnd": {
        const open = openSubgraphs.pop();
        if (open === undefined) {
          refuse(pending, "endWithoutSubgraph");
          break;
        }
        const id = open.statement.id.text;
        const members: string[] = [];
        for (const member of open.members) {
          if (member.trim() === "" || members.includes(member)) continue;
          if (member === id) continue;
          if (registered.some((other) => other.members.includes(member)))
            continue;
          members.push(member);
        }
        const subgraph: MutableSubgraph = {
          id,
          title: open.statement.title?.value ?? id,
          labelType: open.statement.title?.labelType ?? "text",
          members,
          direction: open.direction,
          classes: [],
          statementIndex: open.statement.index,
        };
        registered.push(subgraph);
        registeredById.set(id, subgraph);
        pushMember(id);
        output.push(withIndex(pending));
        break;
      }
      case "classDef": {
        for (const name of pending.names) {
          const existing = classDefs.get(name.text) ?? [];
          existing.push(...pending.styles);
          classDefs.set(name.text, existing);
        }
        output.push(withIndex(pending));
        break;
      }
      case "class": {
        for (const target of pending.targets) {
          const className = pending.className.text;
          nodes.get(target.text)?.classes.push(className);
          edgeById.get(target.text)?.classes.push(className);
          registeredById.get(target.text)?.classes.push(className);
        }
        output.push(withIndex(pending));
        break;
      }
      case "style": {
        const id = pending.target.text;
        if (edgeById.has(id)) {
          refuse(pending, "edgeIdSwallowsNode");
          break;
        }
        let node = nodes.get(id);
        if (node === undefined) {
          node = {
            id,
            text: id,
            labelType: "text",
            shape: null,
            classes: [],
            styles: [],
            hasLink: false,
            explicitLabel: false,
            firstMention: { statementIndex, origin: "styleStatement" },
          };
          nodes.set(id, node);
        }
        node.styles.push(...pending.styles);
        output.push(withIndex(pending));
        break;
      }
      case "linkStyle": {
        const outOfRange = pending.indexes.some(
          (index) => index >= edges.length,
        );
        if (outOfRange) {
          refuse(pending, "linkStyleOutOfRange");
          break;
        }
        const interpolate = pending.interpolate?.text ?? null;
        if (pending.appliesToDefault) {
          if (interpolate !== null) defaultInterpolate = interpolate;
          if (pending.styleText !== null) defaultStyle = [...pending.styles];
        }
        for (const index of pending.indexes) {
          const edge = edges[index] as MutableEdge;
          if (interpolate !== null) edge.interpolate = interpolate;
          if (pending.styleText !== null) {
            const style = [...pending.styles];
            if (
              style.length > 0 &&
              !style.some((item) =>
                item.startsWith(FLOWCHART_LINK_STYLE_FILL_PREFIX),
              )
            ) {
              style.push(FLOWCHART_LINK_STYLE_FILL_DEFAULT);
            }
            edge.style = style;
          }
        }
        output.push(withIndex(pending));
        break;
      }
      case "click": {
        const isLink = pending.form === "link" || pending.form === "href";
        for (const target of pending.targets) {
          const id = target.text;
          const node = nodes.get(id);
          if (node !== undefined && isLink) node.hasLink = true;
          node?.classes.push(FLOWCHART_CLICKABLE_CLASS);
          edgeById.get(id)?.classes.push(FLOWCHART_CLICKABLE_CLASS);
          registeredById.get(id)?.classes.push(FLOWCHART_CLICKABLE_CLASS);
          if (pending.tooltip !== null) tooltipIds.add(id);
        }
        output.push(withIndex(pending));
        break;
      }
      case "edgeAttributes":
      case "accessibility":
        output.push(withIndex(pending));
        break;
    }
  }

  for (const open of openSubgraphs) {
    refusals.push({ pending: open.statement, reason: "unclosedSubgraph" });
    output[open.outputPosition] = null;
  }

  const statements = output.filter(
    (statement): statement is FlowchartStatement => statement !== null,
  );
  const meaning: FlowchartMeaning = {
    direction,
    nodes: [...nodes.values()].map(
      (node): FlowchartNodeMeaning => ({
        ...node,
        hasTooltip: tooltipIds.has(node.id),
      }),
    ),
    edges: edges.map((edge): FlowchartEdgeMeaning => ({ ...edge })),
    subgraphs: registered.map(
      (subgraph): FlowchartSubgraphMeaning => ({
        ...subgraph,
      }),
    ),
    classDefs: [...classDefs.entries()].map(([name, styles]) => ({
      name,
      styles,
    })),
    edgeDefaults: { style: defaultStyle, interpolate: defaultInterpolate },
  };
  return {
    statements,
    refusals,
    meaning: refusals.length === 0 ? meaning : null,
    edgeCount: edges.length,
    declaredEdgeIds,
  };
}

type FlowchartVertexStatementShape = Omit<FlowchartVertexStatement, "index">;
