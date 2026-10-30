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
): BlockExtent | null {
  let level = 0;
  const branches: number[] = [];
  for (let index = startIndex + 1; index < statements.length; index += 1) {
    const statement = statements[index];
    if (statement === undefined) break;
    if (statement.kind === "blockStart") {
      level += 1;
    } else if (statement.kind === "blockEnd") {
      if (level === 0) return { start: startIndex, end: index, branches };
      level -= 1;
    } else if (statement.kind === "branch" && level === 0) {
      branches.push(index);
    }
  }
  return null;
}

// The statements of one branch: its header and everything up to the next branch header or
// the `end` of the block (nested blocks are inside). Null when the list is malformed.
export function branchSegmentOf(
  statements: readonly SequenceStatement[],
  branchIndex: number,
): readonly number[] | null {
  let level = 0;
  const segment = [branchIndex];
  for (let index = branchIndex + 1; index < statements.length; index += 1) {
    const statement = statements[index];
    if (statement === undefined) return null;
    if (statement.kind === "blockStart") {
      level += 1;
    } else if (statement.kind === "blockEnd") {
      if (level === 0) return segment;
      level -= 1;
    } else if (statement.kind === "branch" && level === 0) {
      return segment;
    }
    segment.push(index);
  }
  return null;
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
