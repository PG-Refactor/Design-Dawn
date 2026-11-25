import {
  SEQUENCE_BRANCH_OWNERS,
  type SequenceBlock,
  type SequenceBranch,
} from "./sequence-config";
import type { SequenceStatement } from "./sequence-types";

// The nesting of blocks, read from the statement list (statement.index is the position in
// the list). Pure helpers shared by the Tier 2 operations.

export interface BlockExtent {
  // Statement indexes of the header, of the matching `end` and of the branch headers that
  // belong directly to this block.
  readonly start: number;
  readonly end: number;
  readonly branches: readonly number[];
}

export function blockExtentOf(
  statements: readonly SequenceStatement[],
  startIndex: number,
): BlockExtent {
  let level = 0;
  const branches: number[] = [];
  const first = startIndex + 1;
  const offset = statements.slice(first).findIndex((statement, position) => {
    if (statement.kind === "blockStart") {
      level += 1;
    } else if (statement.kind === "blockEnd") {
      if (level === 0) return true;
      level -= 1;
    } else if (statement.kind === "branch" && level === 0) {
      branches.push(first + position);
    }
    return false;
  });
  // A readable diagram closes every block it opens, so the end is found.
  return { start: startIndex, end: first + offset, branches };
}

// The statements of one branch: its header and everything up to the next branch header or
// the `end` of the block (nested blocks are inside). Null when the list is malformed.
export function branchSegmentOf(
  statements: readonly SequenceStatement[],
  branchIndex: number,
): readonly number[] {
  let level = 0;
  const first = branchIndex + 1;
  // A readable diagram closes every block, so the branch ends at the next branch of its
  // block or at the block's end.
  const offset = statements.slice(first).findIndex((statement) => {
    if (statement.kind === "blockStart") {
      level += 1;
    } else if (statement.kind === "blockEnd") {
      if (level === 0) return true;
      level -= 1;
    } else if (statement.kind === "branch" && level === 0) {
      return true;
    }
    return false;
  });
  return Array.from(
    { length: offset + 1 },
    (_, position) => branchIndex + position,
  );
}

// For every statement, the index of the block header that directly contains it (null at
// the top level). A header or an `end` belongs to the block around it; a branch header to
// its own block.
export function parentBlocks(
  statements: readonly SequenceStatement[],
): readonly (number | null)[] {
  const stack: number[] = [];
  return statements.map((statement) => {
    if (statement.kind === "blockEnd") {
      stack.pop();
      return stack[stack.length - 1] ?? null;
    }
    const parent = stack[stack.length - 1] ?? null;
    if (statement.kind === "blockStart") stack.push(statement.index);
    return parent;
  });
}

// The branch keyword a block takes (`else` for `alt` ...), or null for a block without
// branches.
export function branchKeywordOf(block: SequenceBlock): SequenceBranch | null {
  for (const [branch, owners] of Object.entries(SEQUENCE_BRANCH_OWNERS) as [
    SequenceBranch,
    readonly SequenceBlock[],
  ][]) {
    if (owners.includes(block)) return branch;
  }
  return null;
}
