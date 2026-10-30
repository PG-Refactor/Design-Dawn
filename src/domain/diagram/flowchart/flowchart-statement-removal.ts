import { type DomainResult, ok } from "../../shared/domain-result";
import type { TextEdit } from "../text-edit";
import { refuse } from "./flowchart-operation-support";
import type { FlowchartReading } from "./flowchart-reader";
import type { FlowchartStatement, TextSpan } from "./flowchart-types";

// Taking whole statements out of a text. A statement that has
// its line to itself takes the line with it; one that shares a line (`A; B --> C`) takes the
// separator next to it, so no `;;` or dangling `;` is left behind.

export interface StatementRemoval {
  // Lines that go whole.
  readonly lines: ReadonlySet<number>;
  // Everything else.
  readonly edits: readonly TextEdit[];
}

export function removeStatements(
  reading: FlowchartReading,
  removed: ReadonlySet<FlowchartStatement>,
): DomainResult<StatementRemoval> {
  const lines = new Set<number>();
  const edits: TextEdit[] = [];
  const lineIndexes = new Set([...removed].map((item) => item.lineIndex));
  for (const lineIndex of lineIndexes) {
    const onLine = reading.statements
      .filter((statement) => statement.lineIndex === lineIndex)
      .sort((left, right) => left.span.start - right.span.start);
    if (onLine.every((statement) => removed.has(statement))) {
      if (reading.lines[lineIndex]?.kind !== "statement") {
        return refuse(
          "statementSharesLine",
          `line ${lineIndex + 1} also holds the header`,
        );
      }
      lines.add(lineIndex);
      continue;
    }
    if (reading.lines[lineIndex]?.kind !== "statement") {
      return refuse(
        "statementSharesLine",
        `line ${lineIndex + 1} also holds the header`,
      );
    }
    let position = 0;
    while (position < onLine.length) {
      const first = onLine[position] as FlowchartStatement;
      if (!removed.has(first)) {
        position += 1;
        continue;
      }
      let last = position;
      while (
        last + 1 < onLine.length &&
        removed.has(onLine[last + 1] as FlowchartStatement)
      ) {
        last += 1;
      }
      const lastStatement = onLine[last] as FlowchartStatement;
      const before = onLine[position - 1];
      const after = onLine[last + 1];
      if (before !== undefined) {
        edits.push({
          start: before.span.end,
          end: lastStatement.span.end,
          text: "",
        });
      } else if (after !== undefined) {
        edits.push({
          start: first.span.start,
          end: after.span.start,
          text: "",
        });
      }
      position = last + 1;
    }
  }
  return ok({ lines, edits });
}

// Removes the entries of a list written with a separator between them (`A & B & C`,
// `A,B,C`) whose flag is set; at least one entry stays. A run of removed entries takes the
// separator after it, or, at the end of the list, the separator before it.
export function removeListEntries(
  entries: readonly TextSpan[],
  removed: readonly boolean[],
): readonly TextEdit[] {
  const edits: TextEdit[] = [];
  let position = 0;
  while (position < entries.length) {
    if (removed[position] !== true) {
      position += 1;
      continue;
    }
    let last = position;
    while (removed[last + 1] === true) last += 1;
    const first = entries[position] as TextSpan;
    const lastEntry = entries[last] as TextSpan;
    const before = entries[position - 1];
    const after = entries[last + 1];
    if (after !== undefined) {
      edits.push({ start: first.start, end: after.start, text: "" });
    } else if (before !== undefined) {
      edits.push({ start: before.end, end: lastEntry.end, text: "" });
    }
    position = last + 1;
  }
  return edits;
}
