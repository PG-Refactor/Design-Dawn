import { type DomainResult, err, ok } from "../../shared/domain-result";
import { applyTextEdits, type TextEdit } from "../text-edit";
import { flowchartEditability } from "./flowchart-editability";
import {
  checkFlowchartMeaning,
  type FlowchartEdgeMeaning,
  type FlowchartMeaning,
} from "./flowchart-meaning";
import { type FlowchartReading, readFlowchart } from "./flowchart-reader";
import type {
  FlowchartLink,
  FlowchartNodeTerm,
  FlowchartVertexStatement,
} from "./flowchart-types";

// Shared by the operations: reading the source, finding the thing an operation names, and
// proving a set of edits against the meaning it promised.

export interface PreparedFlowchart {
  readonly reading: FlowchartReading;
  readonly meaning: FlowchartMeaning;
}

export interface FlowchartEdgeTarget {
  // Position in Mermaid's edge order (the `linkStyle` index) and the edge's id (`L_A_B_0`
  // or the user's `e1`). Both must agree, so a target made from an older text cannot
  // silently name another edge.
  readonly index: number;
  readonly id: string;
}

export function refuse<T>(reason: string, detail: string): DomainResult<T> {
  return err("invalidDiagramOperation", `${reason}: ${detail}`);
}

export function prepareFlowchart(
  source: string,
): DomainResult<PreparedFlowchart> {
  const reading = readFlowchart(source);
  const editability = flowchartEditability(reading);
  if (!editability.editable) {
    return err(
      "diagramNotEditable",
      `${editability.reason}: ${editability.detail}`,
    );
  }
  if (reading.meaning === null) {
    return err(
      "diagramNotEditable",
      "unsupportedStatements: the meaning of the text could not be established",
    );
  }
  return ok({ reading, meaning: reading.meaning });
}

export interface ResolvedEdge {
  readonly index: number;
  readonly edge: FlowchartEdgeMeaning;
  readonly statement: FlowchartVertexStatement;
  readonly link: FlowchartLink;
  // links[linkIndex] of the statement.
  readonly linkIndex: number;
}

// Finds the edge a target names. An edge that comes from an `A & B --> C` list is refused:
// one written link makes several edges, so a change to it is not a change to one edge.
export function resolveEdge(
  prepared: PreparedFlowchart,
  target: FlowchartEdgeTarget,
): DomainResult<ResolvedEdge> {
  const { reading, meaning } = prepared;
  const edge = Number.isInteger(target.index)
    ? meaning.edges[target.index]
    : undefined;
  if (edge === undefined) {
    return refuse("targetNotFound", `no edge at index ${target.index}`);
  }
  if (edge.id !== target.id) {
    return refuse(
      "targetMismatch",
      `edge ${target.index} is ${edge.id}, not ${target.id}`,
    );
  }
  if (edge.sharedByAmpersand) {
    return refuse(
      "sharedLink",
      "the link joins an `&` list, so it belongs to several edges",
    );
  }
  const statement = reading.statements.find(
    (candidate) => candidate.index === edge.statementIndex,
  );
  const link =
    statement?.kind === "edge" || statement?.kind === "node"
      ? statement.links[edge.linkIndex]
      : undefined;
  if (
    statement === undefined ||
    (statement.kind !== "edge" && statement.kind !== "node") ||
    link === undefined
  ) {
    return refuse("targetNotFound", `edge ${edge.id} has no written link`);
  }
  return ok({
    index: target.index,
    edge,
    statement,
    link,
    linkIndex: edge.linkIndex,
  });
}

export interface TermReference {
  readonly statement: FlowchartVertexStatement;
  readonly groupIndex: number;
  readonly term: FlowchartNodeTerm;
}

// Every written mention of a node, in source order.
export function termsOf(
  reading: FlowchartReading,
  nodeId: string,
): readonly TermReference[] {
  const references: TermReference[] = [];
  for (const statement of reading.statements) {
    if (statement.kind !== "node" && statement.kind !== "edge") continue;
    statement.groups.forEach((group, groupIndex) => {
      for (const term of group.terms) {
        if (term.id.text === nodeId) {
          references.push({ statement, groupIndex, term });
        }
      }
    });
  }
  return references;
}

export interface Candidate {
  readonly text: string;
}

// Applies the edits and proves the result: it must read as an editable flowchart whose
// meaning is exactly the expected one. Pure and cheap (no rendering), so an operation can try
// plans in order and keep the first that holds.
export function candidateOf(
  source: string,
  edits: readonly TextEdit[],
  expected: FlowchartMeaning,
): DomainResult<Candidate> {
  const applied = applyTextEdits(source, edits);
  if (!applied.ok) return applied;
  const checked = checkFlowchartMeaning(
    readFlowchart(applied.value.text),
    expected,
  );
  if (!checked.ok) return checked;
  return ok({ text: applied.value.text });
}

// The last line of defence of a plan that has only one way to be written: if its own
// candidate does not read back as promised, the operation is refused instead of handed out.
export function confirmEdits(
  source: string,
  edits: readonly TextEdit[],
  expected: FlowchartMeaning,
): DomainResult<void> {
  if (edits.length === 0) return ok(undefined);
  const candidate = candidateOf(source, edits, expected);
  if (candidate.ok) return ok(undefined);
  return refuse("planUnverified", candidate.error.detail);
}
