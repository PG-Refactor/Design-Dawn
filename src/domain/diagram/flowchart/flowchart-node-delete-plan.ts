import { type DomainResult, ok } from "../../shared/domain-result";
import type { TextEdit } from "../text-edit";
import {
  repairEdgeAttributes,
  repairLinkStyles,
} from "./flowchart-edge-delete-plan";
import { deleteLinesEdits } from "./flowchart-edit-lines";
import type { FlowchartMeaning } from "./flowchart-meaning";
import { withoutNode } from "./flowchart-meaning-edit";
import {
  candidateOf,
  type PreparedFlowchart,
  refuse,
} from "./flowchart-operation-support";
import {
  removeListEntries,
  removeStatements,
} from "./flowchart-statement-removal";
import type {
  FlowchartClassStatement,
  FlowchartClickStatement,
  FlowchartStatement,
  FlowchartVertexStatement,
} from "./flowchart-types";

// Deleting a node (docs/architecture.md §16.15.14). Every written mention goes: the term in
// its statement (with the links it was an end of), `style X`, `X` in the target lists of
// `class` and `click`, and the numbers of the `linkStyle` lines behind the edges that
// disappear. Each statement is first cut so that the other nodes it mentioned stay exactly
// where and what they were; a statement that can go whole is removed whole only when the
// result still reads back as exactly "the same diagram without the node".

const BRIDGE = "; ";

interface Cut {
  // Removes the whole statement.
  readonly whole: boolean;
  // Cuts inside the statement; empty when `whole`.
  readonly edits: readonly TextEdit[];
}

// What is left of `A --> X --> B` once X is gone: the pieces that do not touch X, each a
// statement of its own (`A; B`). A group of an `&` list loses only the term.
function cutVertexStatement(
  statement: FlowchartVertexStatement,
  nodeId: string,
): Cut {
  const { groups } = statement;
  const dead = groups.map((group) =>
    group.terms.every((term) => term.id.text === nodeId),
  );
  if (dead.every(Boolean)) return { whole: true, edits: [] };
  const edits: TextEdit[] = [];
  groups.forEach((group, position) => {
    if (dead[position] === true) return;
    const flags = group.terms.map((term) => term.id.text === nodeId);
    if (flags.some(Boolean)) {
      edits.push(
        ...removeListEntries(
          group.terms.map((term) => term.span),
          flags,
        ),
      );
    }
  });
  let position = 0;
  while (position < groups.length) {
    if (dead[position] !== true) {
      position += 1;
      continue;
    }
    let last = position;
    while (dead[last + 1] === true) last += 1;
    const before = groups[position - 1];
    const after = groups[last + 1];
    const first = groups[position];
    const lastGroup = groups[last];
    if (first === undefined || lastGroup === undefined) break;
    if (before === undefined && after !== undefined) {
      edits.push({
        start: first.span.start,
        end: after.span.start,
        text: "",
      });
    } else if (before !== undefined && after !== undefined) {
      edits.push({
        start: before.span.end,
        end: after.span.start,
        text: BRIDGE,
      });
    } else if (before !== undefined) {
      edits.push({
        start: before.span.end,
        end: lastGroup.span.end,
        text: "",
      });
    }
    position = last + 1;
  }
  return { whole: false, edits };
}

function cutTargetList(
  statement: FlowchartClassStatement | FlowchartClickStatement,
  nodeId: string,
): Cut {
  const flags = statement.targets.map((target) => target.text === nodeId);
  if (flags.every(Boolean)) return { whole: true, edits: [] };
  return {
    whole: false,
    edits: removeListEntries(
      statement.targets.map((target) => target.span),
      flags,
    ),
  };
}

function cutOf(statement: FlowchartStatement, nodeId: string): Cut | null {
  switch (statement.kind) {
    case "node":
    case "edge":
      return statement.groups.some((group) =>
        group.terms.some((term) => term.id.text === nodeId),
      )
        ? cutVertexStatement(statement, nodeId)
        : null;
    case "style":
      return statement.target.text === nodeId
        ? { whole: true, edits: [] }
        : null;
    case "class":
    case "click":
      return statement.targets.some((target) => target.text === nodeId)
        ? cutTargetList(statement, nodeId)
        : null;
    default:
      return null;
  }
}

export interface NodeDeletion {
  readonly edits: readonly TextEdit[];
  readonly expected: FlowchartMeaning;
}

export function planNodeDeletion(
  source: string,
  prepared: PreparedFlowchart,
  nodeId: string,
): DomainResult<NodeDeletion> {
  const { reading, meaning } = prepared;
  if (!meaning.nodes.some((node) => node.id === nodeId)) {
    return refuse("targetNotFound", `no node ${nodeId}`);
  }
  const expected = withoutNode(meaning, nodeId);
  const removedEdges = meaning.edges.filter(
    (edge) => edge.start === nodeId || edge.end === nodeId,
  );
  const styles = repairLinkStyles(
    prepared,
    new Set(
      meaning.edges.flatMap((edge, index) =>
        removedEdges.includes(edge) ? [index] : [],
      ),
    ),
  );
  if (!styles.ok) return styles;
  const attributeLines = repairEdgeAttributes(
    prepared,
    new Set(
      removedEdges.filter((edge) => edge.userDefinedId).map((edge) => edge.id),
    ),
  );
  if (!attributeLines.ok) return attributeLines;

  const cuts = new Map<FlowchartStatement, Cut>();
  for (const statement of reading.statements) {
    const cut = cutOf(statement, nodeId);
    if (cut !== null) cuts.set(statement, cut);
  }

  const build = (
    wholeExtra: ReadonlySet<FlowchartStatement>,
  ): DomainResult<readonly TextEdit[]> => {
    const whole = new Set<FlowchartStatement>(wholeExtra);
    const inner: TextEdit[] = [];
    for (const [statement, cut] of cuts) {
      if (cut.whole) whole.add(statement);
      else if (!wholeExtra.has(statement)) inner.push(...cut.edits);
    }
    const removal = removeStatements(reading, whole);
    if (!removal.ok) return removal;
    const lines = new Set([
      ...styles.value.lines,
      ...attributeLines.value,
      ...removal.value.lines,
    ]);
    return ok([
      ...deleteLinesEdits(reading, lines),
      ...styles.value.edits,
      ...removal.value.edits,
      ...inner,
    ]);
  };

  const none = new Set<FlowchartStatement>();
  const base = build(none);
  if (!base.ok) return base;
  const baseCandidate = candidateOf(source, base.value, expected);
  if (!baseCandidate.ok) {
    return refuse("notPlainlyDeletable", baseCandidate.error.detail);
  }
  // Prefer to take a statement out whole when only the node's own edges were in it: leaving
  // `A` behind where `A --> X` stood is correct but untidy. Each such change is kept only if
  // the result still reads back as exactly the expected diagram.
  const accepted = new Set<FlowchartStatement>();
  let edits = base.value;
  for (const [statement, cut] of cuts) {
    if (cut.whole || statement.kind === "class" || statement.kind === "click") {
      continue;
    }
    const attempt = new Set(accepted).add(statement);
    const built = build(attempt);
    if (!built.ok) continue;
    if (candidateOf(source, built.value, expected).ok) {
      accepted.add(statement);
      edits = built.value;
    }
  }
  return ok({ edits, expected });
}
