import type { LineRef } from "../source-lines";
import {
  FLOWCHART_MAX_EDGES,
  FLOWCHART_MAX_SOURCE_LENGTH,
  FLOWCHART_UNDRAWABLE_SHAPES,
} from "./flowchart-config";
import type { FlowchartReading } from "./flowchart-reader";
import type { FlowchartStatement } from "./flowchart-types";

// When may the GUI edit a flowchart?
//
// Rule: every statement was understood, Mermaid's pre-parse rewriting cannot have changed
// what a line means, and the diagram has none of the ambiguities that make "change this
// element" mean something else (ids that collide, an edge id declared twice ...). Things the
// reader recognises but later steps will not edit (classDef / class / style / linkStyle /
// click / accTitle / accDescr, markdown labels, edge ids and their attribute lines, the
// `@{}` form) never block here: the diagram stays editable for the operations that do not
// touch them, and each element's own limits are decided where the operations are
// (docs/architecture.md §16.15.4).

export type FlowchartNotEditableReason =
  | "notFlowchart"
  | "sourceTooLong"
  | "structureIssue"
  | "loneCarriageReturn"
  | "markupRewrite"
  | "styleLikeText"
  | "inlineDirective"
  | "unsupportedStatements"
  | "tooManyEdges"
  | "duplicateEdgeId"
  | "nodeSubgraphIdConflict"
  | "nodeEdgeIdConflict"
  | "undrawableShape";

export type FlowchartEditability =
  | { readonly editable: true }
  | {
      readonly editable: false;
      readonly reason: FlowchartNotEditableReason;
      readonly detail: string;
      // Lines (as source ranges) behind the reason, when it is about lines.
      readonly lines: readonly LineRef[];
    };

function refOf(reading: FlowchartReading, lineIndex: number): LineRef {
  const line = reading.lines[lineIndex];
  return line === undefined
    ? { index: lineIndex, start: 0, end: 0 }
    : { index: line.index, start: line.start, end: line.end };
}

function uniqueLineRefs(
  reading: FlowchartReading,
  lineIndexes: readonly number[],
): readonly LineRef[] {
  return [...new Set(lineIndexes)]
    .sort((left, right) => left - right)
    .map((index) => refOf(reading, index));
}

function mentionedIds(statement: FlowchartStatement): readonly string[] {
  switch (statement.kind) {
    case "node":
    case "edge":
      return statement.groups.flatMap((group) =>
        group.terms.map((term) => term.id.text),
      );
    case "subgraphStart":
      return [statement.id.text];
    case "edgeAttributes":
      return [statement.id.text];
    default:
      return [];
  }
}

function linesMentioning(
  reading: FlowchartReading,
  ids: ReadonlySet<string>,
): readonly LineRef[] {
  return uniqueLineRefs(
    reading,
    reading.statements
      .filter((statement) => mentionedIds(statement).some((id) => ids.has(id)))
      .map((statement) => statement.lineIndex),
  );
}

function describeOpaque(reading: FlowchartReading): string {
  return reading.opaque
    .map((entry) => `line ${entry.lineIndex + 1} (${entry.reason})`)
    .join(", ");
}

function findDuplicateEdgeIds(reading: FlowchartReading): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of reading.declaredEdgeIds) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  // A declared id that Mermaid did not take (an auto id already has that name) is as
  // ambiguous as a repeated one.
  const applied = new Set(
    (reading.meaning?.edges ?? [])
      .filter((edge) => edge.userDefinedId)
      .map((edge) => edge.id),
  );
  for (const id of reading.declaredEdgeIds) {
    if (!applied.has(id)) duplicates.add(id);
  }
  return duplicates;
}

function intersection(
  left: Iterable<string>,
  right: ReadonlySet<string>,
): ReadonlySet<string> {
  return new Set([...left].filter((value) => right.has(value)));
}

export function flowchartEditability(
  reading: FlowchartReading,
): FlowchartEditability {
  if (!reading.isFlowchart) {
    return {
      editable: false,
      reason: "notFlowchart",
      detail: `not a readable flowchart (${reading.detection.kind})`,
      lines: [],
    };
  }
  if (reading.source.length > FLOWCHART_MAX_SOURCE_LENGTH) {
    return {
      editable: false,
      reason: "sourceTooLong",
      detail: `${reading.source.length} characters; Mermaid draws at most ${FLOWCHART_MAX_SOURCE_LENGTH}`,
      lines: [],
    };
  }
  const [structureIssue] = reading.structureIssues;
  if (structureIssue !== undefined) {
    return {
      editable: false,
      reason: "structureIssue",
      detail: structureIssue,
      lines: [],
    };
  }
  const [sourceIssue] = reading.sourceIssues;
  if (sourceIssue !== undefined) {
    return {
      editable: false,
      reason: sourceIssue.code,
      detail:
        sourceIssue.lineIndexes.length === 0
          ? "Mermaid rewrites this text before reading it"
          : `line ${sourceIssue.lineIndexes.map((index) => index + 1).join(", ")}`,
      lines: uniqueLineRefs(reading, sourceIssue.lineIndexes),
    };
  }
  if (reading.opaque.length > 0) {
    return {
      editable: false,
      reason: "unsupportedStatements",
      detail: describeOpaque(reading),
      lines: uniqueLineRefs(
        reading,
        reading.opaque.map((entry) => entry.lineIndex),
      ),
    };
  }
  if (reading.edgeCount > FLOWCHART_MAX_EDGES) {
    return {
      editable: false,
      reason: "tooManyEdges",
      detail: `${reading.edgeCount} edges; Mermaid draws at most ${FLOWCHART_MAX_EDGES}`,
      lines: [],
    };
  }
  const meaning = reading.meaning;
  if (meaning === null) {
    // Cannot happen once the checks above passed; refuse instead of guessing.
    return {
      editable: false,
      reason: "unsupportedStatements",
      detail: "the meaning of the text could not be established",
      lines: [],
    };
  }
  const duplicateEdgeIds = findDuplicateEdgeIds(reading);
  if (duplicateEdgeIds.size > 0) {
    return {
      editable: false,
      reason: "duplicateEdgeId",
      detail: `Mermaid keeps one edge for an id and quietly renames the others: ${[
        ...duplicateEdgeIds,
      ].join(", ")}`,
      lines: uniqueLineRefs(
        reading,
        reading.statements
          .filter(
            (statement) =>
              (statement.kind === "node" || statement.kind === "edge") &&
              statement.links.some(
                (link) =>
                  link.edgeId !== null &&
                  duplicateEdgeIds.has(link.edgeId.text),
              ),
          )
          .map((statement) => statement.lineIndex),
      ),
    };
  }
  const nodeIds = meaning.nodes.map((node) => node.id);
  const subgraphConflicts = intersection(
    nodeIds,
    new Set(meaning.subgraphs.map((subgraph) => subgraph.id)),
  );
  if (subgraphConflicts.size > 0) {
    return {
      editable: false,
      reason: "nodeSubgraphIdConflict",
      detail: `a node and a subgraph share the id ${[...subgraphConflicts].join(", ")}`,
      lines: linesMentioning(reading, subgraphConflicts),
    };
  }
  const edgeConflicts = intersection(
    nodeIds,
    new Set(meaning.edges.map((edge) => edge.id)),
  );
  if (edgeConflicts.size > 0) {
    return {
      editable: false,
      reason: "nodeEdgeIdConflict",
      detail: `a node and an edge share the id ${[...edgeConflicts].join(", ")}`,
      lines: linesMentioning(reading, edgeConflicts),
    };
  }
  // Mermaid parses these shapes but cannot draw them, so the diagram is already broken and
  // no edit could pass the render check: the text has to be fixed in the source.
  const undrawable = new Set(
    meaning.nodes
      .filter(
        (node) =>
          node.shape !== null &&
          (FLOWCHART_UNDRAWABLE_SHAPES as readonly string[]).includes(
            node.shape,
          ),
      )
      .map((node) => node.id),
  );
  if (undrawable.size > 0) {
    return {
      editable: false,
      reason: "undrawableShape",
      detail: `Mermaid cannot draw the shape of ${[...undrawable].join(", ")}`,
      lines: linesMentioning(reading, undrawable),
    };
  }
  return { editable: true };
}
