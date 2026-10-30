import { type DomainResult, ok } from "../../shared/domain-result";
import type { TextEdit } from "../text-edit";
import { FLOWCHART_LINK_STYLE_DEFAULT } from "./flowchart-config";
import { deleteLinesEdits, occupiesWholeLine } from "./flowchart-edit-lines";
import type { FlowchartMeaning } from "./flowchart-meaning";
import { withoutEdge } from "./flowchart-meaning-edit";
import {
  candidateOf,
  type PreparedFlowchart,
  type ResolvedEdge,
  refuse,
} from "./flowchart-operation-support";
import type { FlowchartLinkStyleStatement } from "./flowchart-types";

// Deleting an edge (docs/architecture.md §16.15.12). The statement is cut so that nothing else
// it said is lost, and everything that names the edge by position is repaired in the same set
// of edits: the `linkStyle` numbers behind it move down by one and its own number goes, and
// the `id@{ ... }` lines of an edge with an id of its own go too (left behind they would
// create a node named like the id).

const LINK_REPLACEMENT = "; ";
const TARGET_SEPARATOR = ",";

export interface RepairedLines {
  // Lines that are removed whole.
  readonly lines: ReadonlySet<number>;
  // Everything else that changes.
  readonly edits: readonly TextEdit[];
}

// `removedIndexes` are the positions (linkStyle numbers) of the edges that go. A number moves
// down by the count of removed edges before it, so deleting one edge and deleting every edge
// of a node use the same repair.
export function repairLinkStyles(
  prepared: PreparedFlowchart,
  removedIndexes: ReadonlySet<number>,
): DomainResult<RepairedLines> {
  const { reading } = prepared;
  const lines = new Set<number>();
  const edits: TextEdit[] = [];
  const linkStyles = reading.statements.filter(
    (statement): statement is FlowchartLinkStyleStatement =>
      statement.kind === "linkStyle",
  );
  for (const statement of linkStyles) {
    const survivors: string[] = [];
    let changed = false;
    for (const target of statement.targets) {
      if (target.text === FLOWCHART_LINK_STYLE_DEFAULT) {
        survivors.push(target.text);
        continue;
      }
      const index = Number(target.text);
      if (removedIndexes.has(index)) {
        changed = true;
        continue;
      }
      const shift = [...removedIndexes].filter(
        (removed) => removed < index,
      ).length;
      if (shift > 0) {
        survivors.push(String(index - shift));
        changed = true;
      } else {
        survivors.push(target.text);
      }
    }
    if (!changed) continue;
    if (survivors.length === 0) {
      if (!occupiesWholeLine(reading, statement)) {
        return refuse(
          "linkStyleSharesLine",
          `the linkStyle statement on line ${statement.lineIndex + 1} shares its line with another statement`,
        );
      }
      lines.add(statement.lineIndex);
      continue;
    }
    if (survivors.length === statement.targets.length) {
      // Only renumbering: touch just the numbers that change, keep the spelling around them.
      statement.targets.forEach((target, position) => {
        const text = survivors[position] as string;
        if (text !== target.text) {
          edits.push({ ...target.span, text });
        }
      });
      continue;
    }
    const first = statement.targets[0];
    const last = statement.targets[statement.targets.length - 1];
    if (first === undefined || last === undefined) continue;
    edits.push({
      start: first.span.start,
      end: last.span.end,
      text: survivors.join(TARGET_SEPARATOR),
    });
  }
  return ok({ lines, edits });
}

// The `id@{ ... }` lines of the edges that go. `edgeIds` are the ids of edges that have an id of
// their own.
export function repairEdgeAttributes(
  prepared: PreparedFlowchart,
  edgeIds: ReadonlySet<string>,
): DomainResult<ReadonlySet<number>> {
  const lines = new Set<number>();
  for (const statement of prepared.reading.statements) {
    if (statement.kind !== "edgeAttributes") continue;
    if (!edgeIds.has(statement.id.text)) continue;
    if (!occupiesWholeLine(prepared.reading, statement)) {
      return refuse(
        "attributeLineShared",
        `the ${statement.id.text}@{ ... } statement on line ${statement.lineIndex + 1} shares its line with another statement`,
      );
    }
    lines.add(statement.lineIndex);
  }
  return ok(lines);
}

interface StatementCut {
  readonly lines: readonly number[];
  readonly edits: readonly TextEdit[];
}

// The ways to cut the statement, best first. Each keeps every node the statement mentioned
// (with its label, shape and place) when it can, and the first whose result reads back as
// exactly "the same diagram without this edge" is used, so the choice depends on the text
// and not on a guess:
//   1. a statement with only this link, alone on its line: the whole line goes;
//   2. the first link: `A --> ` before the rest of the statement goes;
//   3. the last link: ` --> B` at the end goes;
//   4. any link: it becomes `; ` and both neighbours stay as statements of their own.
function statementCuts(edge: ResolvedEdge, prepared: PreparedFlowchart) {
  const { statement, linkIndex } = edge;
  const cuts: StatementCut[] = [];
  const groups = statement.kind === "edge" ? statement.groups : [];
  const before = groups[linkIndex];
  const after = groups[linkIndex + 1];
  if (before === undefined || after === undefined) return cuts;
  if (
    statement.links.length === 1 &&
    occupiesWholeLine(prepared.reading, statement)
  ) {
    cuts.push({ lines: [statement.lineIndex], edits: [] });
  }
  if (linkIndex === 0) {
    cuts.push({
      lines: [],
      edits: [{ start: before.span.start, end: after.span.start, text: "" }],
    });
  }
  if (linkIndex === statement.links.length - 1) {
    cuts.push({
      lines: [],
      edits: [{ start: before.span.end, end: after.span.end, text: "" }],
    });
  }
  cuts.push({
    lines: [],
    edits: [
      {
        start: before.span.end,
        end: after.span.start,
        text: LINK_REPLACEMENT,
      },
    ],
  });
  return cuts;
}

export interface EdgeDeletion {
  readonly edits: readonly TextEdit[];
  readonly expected: FlowchartMeaning;
}

export function planEdgeDeletion(
  source: string,
  prepared: PreparedFlowchart,
  edge: ResolvedEdge,
): DomainResult<EdgeDeletion> {
  const expected = withoutEdge(prepared.meaning, edge.index);
  const styles = repairLinkStyles(prepared, new Set([edge.index]));
  if (!styles.ok) return styles;
  const attributeLines = repairEdgeAttributes(
    prepared,
    new Set(edge.edge.userDefinedId ? [edge.edge.id] : []),
  );
  if (!attributeLines.ok) return attributeLines;

  let lastFailure = "no way to cut the statement was tried";
  for (const cut of statementCuts(edge, prepared)) {
    const lines = new Set([
      ...styles.value.lines,
      ...attributeLines.value,
      ...cut.lines,
    ]);
    const edits = [
      ...deleteLinesEdits(prepared.reading, lines),
      ...styles.value.edits,
      ...cut.edits,
    ];
    const candidate = candidateOf(source, edits, expected);
    if (candidate.ok) return ok({ edits, expected });
    lastFailure = candidate.error.detail;
  }
  return refuse("notPlainlyDeletable", lastFailure);
}
