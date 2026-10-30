import { type DomainResult, ok } from "../../shared/domain-result";
import type { TextEdit } from "../text-edit";
import {
  FLOWCHART_MAX_EDGES,
  FLOWCHART_PIPE,
  FLOWCHART_STRING_QUOTE,
  type FlowchartDirection,
  type FlowchartLinkStroke,
  type FlowchartLinkType,
} from "./flowchart-config";
import { planEdgeDeletion } from "./flowchart-edge-delete-plan";
import { appendLineEdit, topLevelIndent } from "./flowchart-edit-lines";
import {
  encodeFlowchartLabel,
  generateNodeId,
  validateNewNodeId,
} from "./flowchart-label-text";
import { type FlowchartLinkSpec, linkTokenOf } from "./flowchart-link-text";
import {
  checkFlowchartMeaning,
  type FlowchartEdgeMeaning,
  type FlowchartMeaning,
  type FlowchartNodeMeaning,
} from "./flowchart-meaning";
import {
  withAppendedEdge,
  withAppendedNode,
  withDirection,
  withEdge,
  withNode,
  withNodesReordered,
} from "./flowchart-meaning-edit";
import { planNodeDeletion } from "./flowchart-node-delete-plan";
import {
  bracketPairOf,
  FLOWCHART_DEFAULT_NEW_NODE_SHAPE,
  FLOWCHART_DIRECTION_WRITE_TOKENS,
  FLOWCHART_EDITABLE_SHAPES,
  type FlowchartEditableShape,
} from "./flowchart-operation-config";
import {
  candidateOf,
  confirmEdits,
  type FlowchartEdgeTarget,
  type PreparedFlowchart,
  prepareFlowchart,
  refuse,
  resolveEdge,
  type TermReference,
  termsOf,
} from "./flowchart-operation-support";
import { readFlowchart } from "./flowchart-reader";
import {
  planCreateSubgraph,
  planDissolveSubgraph,
  planMoveNodeToSubgraph,
  planRemoveNodeFromSubgraph,
  planSetSubgraphDirection,
  planSetSubgraphTitle,
} from "./flowchart-subgraph-operations";

// Tier 1 operations of the flowchart GUI editor (docs/architecture.md §16.15.5 and §16.15.12).
// Pure functions from the current source to a set of TextEdits plus the meaning the result
// must have: "meaning before + what the operation meant". They change only the bytes the
// operation is about (a token, a label, a bracket pair, one inserted or removed line), so
// every other byte stays as it was. The caller applies the edits and proves the candidate
// with `verifyFlowchartCandidate` (the same check every plan also passes before it is handed
// out: when a plan cannot be shown to read back as promised, the operation is refused).

export interface FlowchartLinkChange {
  readonly type: FlowchartLinkType;
  readonly stroke: FlowchartLinkStroke;
  // The edge keeps its length when omitted.
  readonly length?: number;
}

export type FlowchartOperation =
  | { readonly kind: "setDirection"; readonly direction: FlowchartDirection }
  | {
      readonly kind: "setNodeLabel";
      readonly nodeId: string;
      // Plain text as a person sees it (`<`, `>` and a line break are written as entities
      // and `<br/>`).
      readonly label: string;
    }
  | {
      readonly kind: "setNodeShape";
      readonly nodeId: string;
      readonly shape: FlowchartEditableShape;
    }
  | {
      readonly kind: "addNode";
      readonly label: string;
      readonly shape?: FlowchartEditableShape;
      // Made up (`N1`, `N2` ...) when omitted.
      readonly id?: string;
    }
  | {
      readonly kind: "addEdge";
      readonly from: string;
      readonly to: string;
      readonly link?: FlowchartLinkChange;
      readonly label?: string | null;
    }
  | {
      readonly kind: "setEdgeKind";
      readonly target: FlowchartEdgeTarget;
      readonly link: FlowchartLinkChange;
    }
  | {
      readonly kind: "setEdgeLabel";
      readonly target: FlowchartEdgeTarget;
      // null removes the label.
      readonly label: string | null;
    }
  | {
      readonly kind: "reconnectEdge";
      readonly target: FlowchartEdgeTarget;
      readonly end: "start" | "end";
      readonly nodeId: string;
    }
  | { readonly kind: "deleteEdge"; readonly target: FlowchartEdgeTarget }
  // Tier 2 (docs/architecture.md §16.15.14).
  | { readonly kind: "deleteNode"; readonly nodeId: string }
  | {
      readonly kind: "setSubgraphTitle";
      readonly subgraphId: string;
      readonly title: string;
    }
  | {
      readonly kind: "setSubgraphDirection";
      readonly subgraphId: string;
      // null removes the direction line.
      readonly direction: FlowchartDirection | null;
    }
  | {
      readonly kind: "createSubgraph";
      readonly title: string;
      // Made up (`S1`, `S2` ...) when omitted.
      readonly id?: string;
      // A node to put in the new block.
      readonly memberId?: string;
    }
  | { readonly kind: "dissolveSubgraph"; readonly subgraphId: string }
  | {
      readonly kind: "moveNodeToSubgraph";
      readonly nodeId: string;
      readonly subgraphId: string;
    }
  | {
      readonly kind: "removeNodeFromSubgraph";
      readonly nodeId: string;
      readonly subgraphId: string;
    };

export interface FlowchartOperationPlan {
  readonly edits: readonly TextEdit[];
  readonly expected: FlowchartMeaning;
}

const DEFAULT_LINK: FlowchartLinkSpec = {
  type: "arrow_point",
  stroke: "normal",
  length: 1,
};
const SEPARATOR_AND_BLANK = "; ";
const STATEMENT_BLANK = " ";

const quoted = (encoded: string): string =>
  `${FLOWCHART_STRING_QUOTE}${encoded}${FLOWCHART_STRING_QUOTE}`;
const pipeLabel = (encoded: string): string =>
  `${FLOWCHART_PIPE}${quoted(encoded)}${FLOWCHART_PIPE}`;

function planned(
  source: string,
  edits: readonly TextEdit[],
  expected: FlowchartMeaning,
): DomainResult<FlowchartOperationPlan> {
  const confirmed = confirmEdits(source, edits, expected);
  if (!confirmed.ok) return confirmed;
  return ok({ edits, expected });
}

// ---------------------------------------------------------------------------------------
// Direction

function planSetDirection(
  source: string,
  prepared: PreparedFlowchart,
  direction: FlowchartDirection,
): DomainResult<FlowchartOperationPlan> {
  const header = prepared.reading.header;
  const token = FLOWCHART_DIRECTION_WRITE_TOKENS[direction];
  if (header === null || token === undefined) {
    return refuse(
      "invalidDirection",
      `cannot write the direction ${direction}`,
    );
  }
  const expected = withDirection(prepared.meaning, direction);
  if (header.direction === direction) return ok({ edits: [], expected });
  const edit: TextEdit =
    header.directionToken === null
      ? {
          start: header.keywordToken.span.end,
          end: header.keywordToken.span.end,
          text: `${STATEMENT_BLANK}${token}`,
        }
      : { ...header.directionToken.span, text: token };
  return planned(source, [edit], expected);
}

// ---------------------------------------------------------------------------------------
// Nodes

interface NodeWriting {
  // The one mention that gives the node a bracket label, if any.
  readonly definition: TermReference | null;
  // The first mention in the text (where a label is added to an implicit node).
  readonly first: TermReference;
}

// Which mention of a node an edit may touch. Mermaid lets a later definition win, and an
// `@{}` block carries its own label and shape, so more than one definition, an `@{}` node
// and a markdown label are refused: the edit would not be what it looks like.
function writingOfNode(
  prepared: PreparedFlowchart,
  nodeId: string,
): DomainResult<NodeWriting> {
  const terms = termsOf(prepared.reading, nodeId);
  const first = terms[0];
  if (first === undefined) {
    return refuse(
      "nodeNotWritten",
      `${nodeId} is only created by a style statement`,
    );
  }
  if (terms.some((reference) => reference.term.atBlock !== null)) {
    return refuse(
      "atBlockNode",
      `${nodeId} is defined with @{ ... }, which the editor does not rewrite`,
    );
  }
  const definitions = terms.filter(
    (reference) => reference.term.shape !== null,
  );
  if (definitions.length > 1) {
    return refuse(
      "multipleDefinitions",
      `${nodeId} is given a label more than once; the last one wins`,
    );
  }
  const definition = definitions[0] ?? null;
  if (definition?.term.shape?.label.labelType === "markdown") {
    return refuse("markdownLabel", `${nodeId} has a markdown label`);
  }
  return ok({ definition, first });
}

// The reason code (the first word of the refusal) that stops setNodeLabel / setNodeShape on
// this node, or null when they are allowed. Lets a view show a control as unavailable with
// the very reason the operation would give, without planning the operation.
export function nodeEditRestriction(
  prepared: PreparedFlowchart,
  nodeId: string,
): string | null {
  const writing = writingOfNode(prepared, nodeId);
  return writing.ok
    ? null
    : (writing.error.detail.split(":")[0]?.trim() ?? null);
}

function findNode(
  prepared: PreparedFlowchart,
  nodeId: string,
): DomainResult<FlowchartNodeMeaning> {
  const node = prepared.meaning.nodes.find(
    (candidate) => candidate.id === nodeId,
  );
  return node === undefined
    ? refuse("targetNotFound", `no node ${nodeId}`)
    : ok(node);
}

function squareBrackets() {
  const square = bracketPairOf(FLOWCHART_DEFAULT_NEW_NODE_SHAPE);
  if (square === null) throw new Error("the default shape has no brackets");
  return square;
}

function planSetNodeLabel(
  source: string,
  prepared: PreparedFlowchart,
  nodeId: string,
  label: string,
): DomainResult<FlowchartOperationPlan> {
  const node = findNode(prepared, nodeId);
  if (!node.ok) return node;
  const encoded = encodeFlowchartLabel(label);
  if (!encoded.ok) return encoded;
  const writing = writingOfNode(prepared, nodeId);
  if (!writing.ok) return writing;
  const { definition, first } = writing.value;
  const expected = withNode(prepared.meaning, nodeId, {
    text: encoded.value,
    labelType: "text",
    // A bracket label always comes with a shape: an implicit node becomes a rectangle.
    shape: node.value.shape ?? FLOWCHART_DEFAULT_NEW_NODE_SHAPE,
    explicitLabel: true,
  });
  const shape = definition?.term.shape ?? null;
  if (shape !== null) {
    if (encoded.value === node.value.text) return ok({ edits: [], expected });
    const edit: TextEdit = shape.label.quoted
      ? { ...shape.label.content.span, text: encoded.value }
      : {
          // An unquoted label gets its quotes; Mermaid wants them glued to the brackets.
          start: shape.opener.span.end,
          end: shape.closer.span.start,
          text: quoted(encoded.value),
        };
    return planned(source, [edit], expected);
  }
  const brackets = squareBrackets();
  const at = first.term.id.span.end;
  return planned(
    source,
    [
      {
        start: at,
        end: at,
        text: `${brackets.opener}${quoted(encoded.value)}${brackets.closer}`,
      },
    ],
    expected,
  );
}

function isEditableShape(shape: string): shape is FlowchartEditableShape {
  return (FLOWCHART_EDITABLE_SHAPES as readonly string[]).includes(shape);
}

function planSetNodeShape(
  source: string,
  prepared: PreparedFlowchart,
  nodeId: string,
  shapeName: FlowchartEditableShape,
): DomainResult<FlowchartOperationPlan> {
  if (!isEditableShape(shapeName)) {
    return refuse(
      "invalidShape",
      `${shapeName} is not a shape the editor writes`,
    );
  }
  const brackets = bracketPairOf(shapeName);
  if (brackets === null) {
    return refuse("invalidShape", `${shapeName} has no bracket form`);
  }
  const node = findNode(prepared, nodeId);
  if (!node.ok) return node;
  const writing = writingOfNode(prepared, nodeId);
  if (!writing.ok) return writing;
  const { definition, first } = writing.value;
  const expected = withNode(prepared.meaning, nodeId, {
    shape: shapeName,
    explicitLabel: true,
  });
  const shape = definition?.term.shape ?? null;
  if (shape !== null) {
    if (node.value.shape === shapeName) return ok({ edits: [], expected });
    const edits: TextEdit[] = [
      { ...shape.opener.span, text: brackets.opener },
      { ...shape.closer.span, text: brackets.closer },
    ];
    if (!shape.label.quoted) {
      edits.push({
        start: shape.opener.span.end,
        end: shape.closer.span.start,
        text: quoted(shape.label.content.text),
      });
    }
    return planned(source, edits, expected);
  }
  // An implicit node's label is its id; writing the brackets spells that out.
  const encoded = encodeFlowchartLabel(node.value.text);
  if (!encoded.ok) return encoded;
  const at = first.term.id.span.end;
  return planned(
    source,
    [
      {
        start: at,
        end: at,
        text: `${brackets.opener}${quoted(encoded.value)}${brackets.closer}`,
      },
    ],
    expected,
  );
}

function namesInUse(meaning: FlowchartMeaning): ReadonlySet<string> {
  return new Set([
    ...meaning.nodes.map((node) => node.id),
    ...meaning.subgraphs.map((subgraph) => subgraph.id),
    ...meaning.edges.map((edge) => edge.id),
  ]);
}

function planAddNode(
  source: string,
  prepared: PreparedFlowchart,
  input: {
    readonly label: string;
    readonly shape?: FlowchartEditableShape;
    readonly id?: string;
  },
): DomainResult<FlowchartOperationPlan> {
  const { reading, meaning } = prepared;
  const shapeName = input.shape ?? FLOWCHART_DEFAULT_NEW_NODE_SHAPE;
  const brackets = isEditableShape(shapeName) ? bracketPairOf(shapeName) : null;
  if (brackets === null) {
    return refuse(
      "invalidShape",
      `${shapeName} is not a shape the editor writes`,
    );
  }
  const encoded = encodeFlowchartLabel(input.label);
  if (!encoded.ok) return encoded;
  const taken = namesInUse(meaning);
  const id = input.id ?? generateNodeId(taken);
  const checked = validateNewNodeId(id, taken);
  if (!checked.ok) return checked;
  const statement = `${topLevelIndent(reading)}${id}${brackets.opener}${quoted(encoded.value)}${brackets.closer}`;
  const expected = withAppendedNode(meaning, {
    id,
    text: encoded.value,
    labelType: "text",
    shape: shapeName,
    classes: [],
    styles: [],
    hasLink: false,
    hasTooltip: false,
    explicitLabel: true,
    firstMention: {
      statementIndex: reading.statements.length,
      origin: "definition",
    },
  });
  return planned(source, [appendLineEdit(reading, statement)], expected);
}

// ---------------------------------------------------------------------------------------
// Edges

const INVISIBLE_STROKE: FlowchartLinkStroke = "invisible";

function specOf(
  base: FlowchartLinkSpec,
  change: FlowchartLinkChange | undefined,
): FlowchartLinkSpec {
  return {
    type: change?.type ?? base.type,
    stroke: change?.stroke ?? base.stroke,
    length: change?.length ?? base.length,
  };
}

function planAddEdge(
  source: string,
  prepared: PreparedFlowchart,
  input: {
    readonly from: string;
    readonly to: string;
    readonly link?: FlowchartLinkChange;
    readonly label?: string | null;
  },
): DomainResult<FlowchartOperationPlan> {
  const { reading, meaning } = prepared;
  for (const nodeId of [input.from, input.to]) {
    if (!meaning.nodes.some((node) => node.id === nodeId)) {
      return refuse(
        "targetNotFound",
        `${nodeId} is not a node (a subgraph or an unknown id cannot be an endpoint)`,
      );
    }
  }
  if (reading.edgeCount >= FLOWCHART_MAX_EDGES) {
    return refuse(
      "tooManyEdges",
      `the diagram already has ${reading.edgeCount} edges`,
    );
  }
  const spec = specOf(DEFAULT_LINK, input.link);
  const token = linkTokenOf(spec);
  if (!token.ok) return token;
  const hasLabel = input.label !== undefined && input.label !== null;
  let labelText = "";
  if (hasLabel) {
    if (spec.stroke === INVISIBLE_STROKE) {
      return refuse(
        "invisibleLinkLabel",
        "an invisible link cannot carry a label",
      );
    }
    const encoded = encodeFlowchartLabel(input.label as string);
    if (!encoded.ok) return encoded;
    labelText = encoded.value;
  }
  const statement = `${topLevelIndent(reading)}${input.from}${STATEMENT_BLANK}${token.value}${hasLabel ? pipeLabel(labelText) : ""}${STATEMENT_BLANK}${input.to}`;
  const expected = withAppendedEdge(meaning, {
    id: "",
    userDefinedId: false,
    start: input.from,
    end: input.to,
    type: spec.type,
    stroke: spec.stroke,
    length: spec.length,
    text: labelText,
    labelType: "text",
    labelForm: hasLabel ? "pipe" : null,
    style: null,
    interpolate: meaning.edgeDefaults.interpolate,
    classes: [],
    animate: null,
    animation: null,
    statementIndex: reading.statements.length,
    linkIndex: 0,
    sharedByAmpersand: false,
  });
  return planned(source, [appendLineEdit(reading, statement)], expected);
}

const WORD_CHARACTER = /[\p{L}\p{N}_]/u;
const LINK_LETTER_ENDS = ["x", "o"];

// A link that starts or ends with the letter `x` or `o` (`x--x`, `--o`) merges with a node id
// written right next to it (`Ax--xB` is the nodes `Ax` and `B`). Where the old link touched
// its neighbours the new one gets a blank on that side; everywhere else the blanks around the
// link stay exactly as they were.
function paddedLink(
  source: string,
  span: { readonly start: number; readonly end: number },
  text: string,
): string {
  const before = source.charAt(span.start - 1);
  const after = source.charAt(span.end);
  const startsWithLetter = LINK_LETTER_ENDS.includes(text.charAt(0));
  const endsWithLetter = LINK_LETTER_ENDS.includes(
    text.charAt(text.length - 1),
  );
  const leading =
    startsWithLetter && WORD_CHARACTER.test(before) ? STATEMENT_BLANK : "";
  const trailing =
    endsWithLetter && WORD_CHARACTER.test(after) ? STATEMENT_BLANK : "";
  return `${leading}${text}${trailing}`;
}

function currentSpec(edge: FlowchartEdgeMeaning): FlowchartLinkSpec {
  return { type: edge.type, stroke: edge.stroke, length: edge.length };
}

function planSetEdgeKind(
  source: string,
  prepared: PreparedFlowchart,
  target: FlowchartEdgeTarget,
  change: FlowchartLinkChange,
): DomainResult<FlowchartOperationPlan> {
  const resolved = resolveEdge(prepared, target);
  if (!resolved.ok) return resolved;
  const { edge, link } = resolved.value;
  const spec = specOf(currentSpec(edge), change);
  const token = linkTokenOf(spec);
  if (!token.ok) return token;
  if (spec.stroke === INVISIBLE_STROKE && link.label !== null) {
    return refuse(
      "invisibleLinkLabel",
      "an invisible link cannot carry a label",
    );
  }
  const inline = link.label?.form === "inline" ? link.label : null;
  const expected = withEdge(prepared.meaning, resolved.value.index, {
    type: spec.type,
    stroke: spec.stroke,
    length: spec.length,
    ...(inline === null ? {} : { labelForm: "pipe" as const }),
  });
  if (
    spec.type === edge.type &&
    spec.stroke === edge.stroke &&
    spec.length === edge.length
  ) {
    return ok({ edits: [], expected: prepared.meaning });
  }
  if (inline !== null) {
    // Both halves of `A -- text --> B` must change together and agree; rewriting it as the
    // pipe form (`A -->|"text"| B`) says the same thing with one token.
    if (inline.label.labelType === "markdown") {
      return refuse("markdownLabel", "the edge has a markdown label");
    }
    const pipe = pipeLabel(inline.label.content.text);
    return planned(
      source,
      [
        {
          ...inline.span,
          text: paddedLink(source, inline.span, `${token.value}${pipe}`),
        },
      ],
      expected,
    );
  }
  return planned(
    source,
    [
      {
        ...link.token.span,
        text: paddedLink(source, link.token.span, token.value),
      },
    ],
    expected,
  );
}

function planSetEdgeLabel(
  source: string,
  prepared: PreparedFlowchart,
  target: FlowchartEdgeTarget,
  label: string | null,
): DomainResult<FlowchartOperationPlan> {
  const resolved = resolveEdge(prepared, target);
  if (!resolved.ok) return resolved;
  const { edge, link } = resolved.value;
  const existing = link.label;
  let encoded = "";
  if (label !== null) {
    if (edge.stroke === INVISIBLE_STROKE) {
      return refuse(
        "invisibleLinkLabel",
        "an invisible link cannot carry a label",
      );
    }
    const result = encodeFlowchartLabel(label);
    if (!result.ok) return result;
    encoded = result.value;
  }
  if (existing?.label.labelType === "markdown") {
    return refuse("markdownLabel", "the edge has a markdown label");
  }
  const expected = withEdge(prepared.meaning, resolved.value.index, {
    text: encoded,
    labelType: "text",
    labelForm: label === null ? null : "pipe",
  });
  if (existing === null) {
    if (label === null) return ok({ edits: [], expected: prepared.meaning });
    const at = link.token.span.end;
    return planned(
      source,
      [{ start: at, end: at, text: pipeLabel(encoded) }],
      expected,
    );
  }
  if (existing.form === "inline") {
    // The inline form cannot be edited in place without rewriting both halves of the link,
    // so it becomes the pipe form, or the bare link when the label is removed.
    const token = linkTokenOf(currentSpec(edge));
    if (!token.ok) return token;
    return planned(
      source,
      [
        {
          ...existing.span,
          text: paddedLink(
            source,
            existing.span,
            `${token.value}${label === null ? "" : pipeLabel(encoded)}`,
          ),
        },
      ],
      expected,
    );
  }
  if (label === null) {
    // Also removes the blanks between the link and the pipe.
    return planned(
      source,
      [{ start: link.token.span.end, end: existing.span.end, text: "" }],
      expected,
    );
  }
  if (encoded === edge.text) return ok({ edits: [], expected });
  return planned(
    source,
    [{ ...existing.span, text: pipeLabel(encoded) }],
    expected,
  );
}

function planReconnectEdge(
  source: string,
  prepared: PreparedFlowchart,
  target: FlowchartEdgeTarget,
  end: "start" | "end",
  nodeId: string,
): DomainResult<FlowchartOperationPlan> {
  const resolved = resolveEdge(prepared, target);
  if (!resolved.ok) return resolved;
  const { statement, linkIndex } = resolved.value;
  if (statement.kind !== "edge") {
    return refuse("targetNotFound", "the edge has no written statement");
  }
  if (!prepared.meaning.nodes.some((node) => node.id === nodeId)) {
    return refuse(
      "targetNotFound",
      `${nodeId} is not a node (a subgraph or an unknown id cannot be an endpoint)`,
    );
  }
  // In `A --> B --> C` the middle node is the end of one edge and the start of the next:
  // changing its token would change both. Only the outer ends belong to one edge.
  const isStart = end === "start";
  const groupIndex = isStart ? linkIndex : linkIndex + 1;
  const isOuterEnd = isStart
    ? linkIndex === 0
    : linkIndex === statement.links.length - 1;
  if (!isOuterEnd) {
    return refuse(
      "sharedEndpoint",
      "the node is also the end of the neighbouring edge in the same chain",
    );
  }
  const term = statement.groups[groupIndex]?.terms[0];
  if (term === undefined) {
    return refuse("targetNotFound", "the edge has no written endpoint");
  }
  if (term.id.text === nodeId) {
    return ok({ edits: [], expected: prepared.meaning });
  }
  // The old node keeps its place and the new one is mentioned where the old one was, so the
  // statement mentions the old node first (at the start) or last (at the end).
  const mentions = statement.groups.flatMap((group) =>
    group.terms.flatMap((candidate) =>
      candidate === term
        ? isStart
          ? [candidate.id.text, nodeId]
          : [nodeId, candidate.id.text]
        : [candidate.id.text],
    ),
  );
  const expected = withNodesReordered(
    withEdge(prepared.meaning, resolved.value.index, {
      [isStart ? "start" : "end"]: nodeId,
    }),
    statement.index,
    mentions,
  );
  // First try the plain swap; when the old node would vanish, lose its label or move in the
  // node order, keep the whole old term as a statement of its own, next to the swapped one
  // (`A; X --> B`, `A --> X; B`).
  const keepOld: TextEdit = {
    ...term.span,
    text: isStart
      ? `${term.text}${SEPARATOR_AND_BLANK}${nodeId}`
      : `${nodeId}${SEPARATOR_AND_BLANK}${term.text}`,
  };
  const plans: readonly TextEdit[] = [
    { ...term.id.span, text: nodeId },
    keepOld,
  ];
  let lastFailure = "";
  for (const edit of plans) {
    const candidate = candidateOf(source, [edit], expected);
    if (candidate.ok) return ok({ edits: [edit], expected });
    lastFailure = candidate.error.detail;
  }
  return refuse("notPlainlyReconnectable", lastFailure);
}

function planDeleteEdge(
  source: string,
  prepared: PreparedFlowchart,
  target: FlowchartEdgeTarget,
): DomainResult<FlowchartOperationPlan> {
  const resolved = resolveEdge(prepared, target);
  if (!resolved.ok) return resolved;
  return planEdgeDeletion(source, prepared, resolved.value);
}

// ---------------------------------------------------------------------------------------

export function planFlowchartOperation(
  source: string,
  operation: FlowchartOperation,
): DomainResult<FlowchartOperationPlan> {
  const prepared = prepareFlowchart(source);
  if (!prepared.ok) return prepared;
  const state = prepared.value;
  switch (operation.kind) {
    case "setDirection":
      return planSetDirection(source, state, operation.direction);
    case "setNodeLabel":
      return planSetNodeLabel(source, state, operation.nodeId, operation.label);
    case "setNodeShape":
      return planSetNodeShape(source, state, operation.nodeId, operation.shape);
    case "addNode":
      return planAddNode(source, state, operation);
    case "addEdge":
      return planAddEdge(source, state, operation);
    case "setEdgeKind":
      return planSetEdgeKind(source, state, operation.target, operation.link);
    case "setEdgeLabel":
      return planSetEdgeLabel(source, state, operation.target, operation.label);
    case "reconnectEdge":
      return planReconnectEdge(
        source,
        state,
        operation.target,
        operation.end,
        operation.nodeId,
      );
    case "deleteEdge":
      return planDeleteEdge(source, state, operation.target);
    case "deleteNode":
      return planNodeDeletion(source, state, operation.nodeId);
    case "setSubgraphTitle":
      return planSetSubgraphTitle(
        source,
        state,
        operation.subgraphId,
        operation.title,
      );
    case "setSubgraphDirection":
      return planSetSubgraphDirection(
        source,
        state,
        operation.subgraphId,
        operation.direction,
      );
    case "createSubgraph":
      return planCreateSubgraph(source, state, operation);
    case "dissolveSubgraph":
      return planDissolveSubgraph(source, state, operation.subgraphId);
    case "moveNodeToSubgraph":
      return planMoveNodeToSubgraph(
        source,
        state,
        operation.nodeId,
        operation.subgraphId,
      );
    case "removeNodeFromSubgraph":
      return planRemoveNodeFromSubgraph(
        source,
        state,
        operation.nodeId,
        operation.subgraphId,
      );
  }
}

// Proves a candidate: it must read as an editable flowchart (every statement understood, at
// most 500 edges and 50000 characters, no phantom node, no directive other than a line of its
// own) whose meaning is exactly what the operation promised.
export function verifyFlowchartCandidate(
  candidateSource: string,
  expected: FlowchartMeaning,
): DomainResult<void> {
  return checkFlowchartMeaning(readFlowchart(candidateSource), expected);
}
