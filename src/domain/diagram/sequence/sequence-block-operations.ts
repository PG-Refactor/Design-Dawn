import type { TextEdit } from "../text-edit";
import { SEQUENCE_END_KEYWORD } from "./sequence-config";
import {
  deleteLinesEdits,
  dominantLineEnding,
  InsertionSet,
  indentOfLine,
  indentUnitOf,
  insertLineAfterEdit,
  insertLineBeforeEdit,
  isFirstOnLine,
  isLastOnLine,
  leadingWhitespaceLength,
  occupiesWholeLine,
  statementsOnLine,
} from "./sequence-edit-lines";
import { withItemInserted, withItemRemoved } from "./sequence-meaning-edit";
import {
  SEQUENCE_KEYWORD_TEXT_SEPARATOR,
  SEQUENCE_UNKNOWN_STATEMENT_INDEX,
  SEQUENCE_WRAP_BLOCKS,
  type SequenceWrapBlock,
} from "./sequence-operation-config";
import {
  lastItemIndexOf,
  type Planned,
  type PreparedSequence,
  planned,
  refuse,
  resolveItem,
  type SequenceItemTarget,
} from "./sequence-operation-support";
import { planStatementRemoval } from "./sequence-removal";
import {
  blockExtentOf,
  branchKeywordOf,
  branchSegmentOf,
  parentBlocks,
} from "./sequence-structure";
import { encodeSequenceText } from "./sequence-text";
import type { SequenceStatement } from "./sequence-types";

// Tier 2 operations on blocks. A block is changed only as a
// whole: its header and its `end` are written or removed together, branches are added or
// removed with their text, and a range that would cut a block or a branch in two is refused.

export interface WrapInBlockOperation {
  readonly kind: "wrapInBlock";
  // The first and the last entry of the range. Each is a message, a note or a block header
  // (a header stands for the whole block); both must be at the same level of the same branch.
  readonly from: SequenceItemTarget;
  readonly to: SequenceItemTarget;
  readonly block: SequenceWrapBlock;
  readonly text: string;
}

export interface UnwrapBlockOperation {
  readonly kind: "unwrapBlock";
  readonly target: SequenceItemTarget;
}

export interface AddBranchOperation {
  readonly kind: "addBranch";
  // The block header the branch is added to.
  readonly target: SequenceItemTarget;
  readonly text: string;
  // The branch starts right behind this message, note or nested block of the block; at the
  // end of the block when omitted.
  readonly after?: SequenceItemTarget;
}

export interface DeleteBranchOperation {
  readonly kind: "deleteBranch";
  readonly target: SequenceItemTarget;
}

// What a branch or wrapped range may hold: anything else (a `participant`, `autonumber` or
// `title` line) is global, so moving or removing it with a block would change more than the
// block.
const RANGE_KINDS: ReadonlySet<SequenceStatement["kind"]> = new Set([
  "message",
  "note",
  "activation",
  "blockStart",
  "branch",
  "blockEnd",
]);

function headerLine(keyword: string, encodedText: string): string {
  return encodedText === ""
    ? keyword
    : `${keyword}${SEQUENCE_KEYWORD_TEXT_SEPARATOR}${encodedText}`;
}

// ---------------------------------------------------------------------------------------

export function planWrapInBlock(
  source: string,
  prepared: PreparedSequence,
  operation: WrapInBlockOperation,
): Planned {
  const { reading, meaning } = prepared;
  if (!SEQUENCE_WRAP_BLOCKS.includes(operation.block)) {
    return refuse("invalidBlock", `unknown block ${operation.block}`);
  }
  const encoded = encodeSequenceText(operation.text, "blockLabel");
  if (!encoded.ok) return encoded;
  const kinds = ["message", "note", "blockStart"] as const;
  const from = resolveItem(prepared, operation.from, kinds);
  if (!from.ok) return from;
  const to = resolveItem(prepared, operation.to, kinds);
  if (!to.ok) return to;
  const first = from.value.statement;
  let lastIndex = to.value.statement.index;
  if (to.value.statement.kind === "blockStart") {
    const extent = blockExtentOf(reading.statements, lastIndex);
    if (extent === null)
      return refuse("rangeCrossesBlock", "the block has no end");
    lastIndex = extent.end;
  }
  if (lastIndex < first.index) {
    return refuse("rangeOrder", "the range ends before it starts");
  }
  let level = 0;
  for (let index = first.index; index <= lastIndex; index += 1) {
    const statement = reading.statements[index];
    if (statement === undefined) break;
    if (!RANGE_KINDS.has(statement.kind)) {
      return refuse(
        "unsupportedInRange",
        `a ${statement.kind} statement stands inside the range`,
      );
    }
    if (statement.kind === "blockStart") level += 1;
    if (statement.kind === "blockEnd") level -= 1;
    if (level < 0 || (statement.kind === "branch" && level === 0)) {
      return refuse(
        "rangeCrossesBlock",
        "the range would cut a block or one of its branches in two",
      );
    }
  }
  if (level !== 0) {
    return refuse("rangeCrossesBlock", "the range ends inside a nested block");
  }
  const last = reading.statements[lastIndex];
  if (last === undefined)
    return refuse("rangeCrossesBlock", "no last statement");
  if (!isFirstOnLine(reading, first) || !isLastOnLine(reading, last)) {
    return refuse(
      "statementsShareLine",
      "the range shares a line with other statements",
    );
  }
  const base = indentOfLine(reading, first.lineIndex);
  const unit = indentUnitOf(reading);
  const ending = dominantLineEnding(reading);
  const insertions = new InsertionSet();
  const firstLine = reading.lines[first.lineIndex];
  if (firstLine === undefined)
    return refuse("rangeCrossesBlock", "no first line");
  insertions.add(
    firstLine.start,
    `${base}${headerLine(operation.block, encoded.value)}${ending}`,
  );
  for (
    let lineIndex = first.lineIndex;
    lineIndex <= last.lineIndex;
    lineIndex += 1
  ) {
    const line = reading.lines[lineIndex];
    if (
      line === undefined ||
      statementsOnLine(reading, lineIndex).length === 0
    ) {
      continue;
    }
    insertions.add(line.start + leadingWhitespaceLength(line.text), unit);
  }
  const edits: TextEdit[] = [
    ...insertions.edits(),
    insertLineAfterEdit(
      reading,
      last.lineIndex,
      `${base}${SEQUENCE_END_KEYWORD}`,
    ),
  ];
  const firstItem = meaning.items.findIndex(
    (item) => item.statementIndex === first.index,
  );
  const lastItem = lastItemIndexOf(meaning, last.index);
  const withEnd = withItemInserted(meaning, lastItem + 1, {
    kind: "blockEnd",
    statementIndex: SEQUENCE_UNKNOWN_STATEMENT_INDEX,
    block: operation.block,
  });
  const expected = withItemInserted(withEnd, firstItem, {
    kind: "blockStart",
    statementIndex: SEQUENCE_UNKNOWN_STATEMENT_INDEX,
    block: operation.block,
    text: encoded.value,
  });
  return planned(source, edits, expected);
}

// ---------------------------------------------------------------------------------------

export function planUnwrapBlock(
  source: string,
  prepared: PreparedSequence,
  operation: UnwrapBlockOperation,
): Planned {
  const { reading, meaning } = prepared;
  const resolved = resolveItem(prepared, operation.target, ["blockStart"]);
  if (!resolved.ok) return resolved;
  const header = resolved.value.statement;
  const extent = blockExtentOf(reading.statements, header.index);
  const end = extent === null ? undefined : reading.statements[extent.end];
  if (extent === null || end === undefined) {
    return refuse("wrongTargetKind", "the block has no end");
  }
  if (extent.branches.length > 0) {
    return refuse(
      "hasBranches",
      "the block has branches; delete them first, or the statements of the other branches would be merged",
    );
  }
  if (!occupiesWholeLine(reading, header) || !occupiesWholeLine(reading, end)) {
    return refuse(
      "statementsShareLine",
      "the header or the end of the block shares its line with something else",
    );
  }
  const headerIndent = indentOfLine(reading, header.lineIndex);
  const inner = reading.statements.filter(
    (statement) =>
      statement.index > header.index && statement.index < end.index,
  );
  const firstInner = inner[0];
  const innerIndent =
    firstInner === undefined ? "" : indentOfLine(reading, firstInner.lineIndex);
  const unit =
    innerIndent.startsWith(headerIndent) &&
    innerIndent.length > headerIndent.length
      ? innerIndent.slice(headerIndent.length)
      : "";
  const edits: TextEdit[] = [
    ...deleteLinesEdits(reading, new Set([header.lineIndex, end.lineIndex])),
  ];
  if (unit !== "") {
    const lines = new Set(inner.map((statement) => statement.lineIndex));
    for (const lineIndex of lines) {
      const line = reading.lines[lineIndex];
      if (line === undefined) continue;
      if (line.text.startsWith(`${headerIndent}${unit}`)) {
        const start = line.start + headerIndent.length;
        edits.push({ start, end: start + unit.length, text: "" });
      }
    }
  }
  const withoutHeader = withItemRemoved(meaning, resolved.value.index);
  const endItem = lastItemIndexOf(meaning, end.index);
  const expected = withItemRemoved(withoutHeader, endItem - 1);
  return planned(source, edits, expected);
}

// ---------------------------------------------------------------------------------------

export function planAddBranch(
  source: string,
  prepared: PreparedSequence,
  operation: AddBranchOperation,
): Planned {
  const { reading, meaning } = prepared;
  const resolved = resolveItem(prepared, operation.target, ["blockStart"]);
  if (!resolved.ok) return resolved;
  const header = resolved.value.statement;
  const keyword = branchKeywordOf(header.block);
  if (keyword === null) {
    return refuse("noBranches", `a ${header.block} block has no branches`);
  }
  const encoded = encodeSequenceText(operation.text, "blockLabel");
  if (!encoded.ok) return encoded;
  const extent = blockExtentOf(reading.statements, header.index);
  const end = extent === null ? undefined : reading.statements[extent.end];
  if (end === undefined)
    return refuse("wrongTargetKind", "the block has no end");
  const line = `${indentOfLine(reading, header.lineIndex)}${headerLine(keyword, encoded.value)}`;
  let edit: TextEdit;
  let itemIndex: number;
  if (operation.after === undefined) {
    if (!isFirstOnLine(reading, end)) {
      return refuse(
        "statementsShareLine",
        "the end of the block shares its line",
      );
    }
    edit = insertLineBeforeEdit(reading, end.lineIndex, line);
    itemIndex = meaning.items.findIndex(
      (item) => item.statementIndex === end.index,
    );
  } else {
    const after = resolveItem(prepared, operation.after, [
      "message",
      "note",
      "blockEnd",
    ]);
    if (!after.ok) return after;
    const parent = parentBlocks(reading.statements)[
      after.value.statement.index
    ];
    if (parent !== header.index) {
      return refuse(
        "notInBlock",
        "the entry is not directly inside this block",
      );
    }
    if (!isLastOnLine(reading, after.value.statement)) {
      return refuse("sharedLine", "the entry is followed by another statement");
    }
    edit = insertLineAfterEdit(reading, after.value.statement.lineIndex, line);
    itemIndex = lastItemIndexOf(meaning, after.value.statement.index) + 1;
  }
  return planned(
    source,
    [edit],
    withItemInserted(meaning, itemIndex, {
      kind: "branch",
      statementIndex: SEQUENCE_UNKNOWN_STATEMENT_INDEX,
      branch: keyword,
      text: encoded.value,
    }),
  );
}

// Deletes the branch with everything in it (the statements of a branch belong to it; keeping
// them would merge them into the branch before).
export function planDeleteBranch(
  source: string,
  prepared: PreparedSequence,
  operation: DeleteBranchOperation,
): Planned {
  const resolved = resolveItem(prepared, operation.target, ["branch"]);
  if (!resolved.ok) return resolved;
  const { reading } = prepared;
  const segment = branchSegmentOf(
    reading.statements,
    resolved.value.statement.index,
  );
  if (segment === null)
    return refuse("wrongTargetKind", "the branch has no block");
  for (const index of segment) {
    const statement = reading.statements[index];
    if (statement !== undefined && !RANGE_KINDS.has(statement.kind)) {
      return refuse(
        "unsupportedInRange",
        `a ${statement.kind} statement stands inside the branch`,
      );
    }
  }
  return planStatementRemoval(source, prepared, new Set(segment), new Set());
}
