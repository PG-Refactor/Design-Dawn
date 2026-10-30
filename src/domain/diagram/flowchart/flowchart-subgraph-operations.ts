import { type DomainResult, ok } from "../../shared/domain-result";
import type { TextEdit } from "../text-edit";
import {
  FLOWCHART_DIRECTION_KEYWORD,
  FLOWCHART_END_KEYWORD,
  FLOWCHART_STRING_QUOTE,
  FLOWCHART_SUBGRAPH_KEYWORD,
  type FlowchartDirection,
  normalizeFlowchartDirection,
} from "./flowchart-config";
import {
  appendLineEdit,
  deleteLinesEdits,
  dominantLineEnding,
  indentOfLine,
  insertLineAfterEdit,
  insertLineBeforeEdit,
  topLevelIndent,
} from "./flowchart-edit-lines";
import {
  encodeFlowchartLabel,
  generateNodeId,
  validateNewNodeId,
} from "./flowchart-label-text";
import type { FlowchartMeaning } from "./flowchart-meaning";
import {
  withAppendedSubgraph,
  withMembers,
  withNodeFirstMention,
  withoutSubgraph,
  withSubgraph,
  withSubgraphDirection,
} from "./flowchart-meaning-edit";
import {
  FLOWCHART_DEFAULT_INDENT,
  FLOWCHART_DIRECTION_WRITE_TOKENS,
  FLOWCHART_GENERATED_SUBGRAPH_ID_PREFIX,
} from "./flowchart-operation-config";
import {
  candidateOf,
  confirmEdits,
  type PreparedFlowchart,
  refuse,
} from "./flowchart-operation-support";
import { removeStatements } from "./flowchart-statement-removal";
import {
  type MentionBlock,
  ownerOf,
  resolveMembers,
  type SubgraphBlock,
  type SubgraphModel,
  subgraphModelOf,
} from "./flowchart-subgraph-model";
import type { FlowchartStatement } from "./flowchart-types";

// Tier 2 subgraph operations: title, direction, creating and
// dissolving a block, and moving a node in or out of one. Same contract as the Tier 1
// operations: minimal edits, and the meaning the result must have, computed from the meaning
// before the edit and what the operation meant (membership through `resolveMembers`), never
// from the text the edits produce.

export interface SubgraphPlan {
  readonly edits: readonly TextEdit[];
  readonly expected: FlowchartMeaning;
}

const quoted = (encoded: string): string =>
  `${FLOWCHART_STRING_QUOTE}${encoded}${FLOWCHART_STRING_QUOTE}`;
const TITLE_OPENER = "[";
const TITLE_CLOSER = "]";
const BLANK = " ";
// A statement number between two statements of the old numbering.
const HALF_STATEMENT = 0.5;

function planned(
  source: string,
  edits: readonly TextEdit[],
  expected: FlowchartMeaning,
): DomainResult<SubgraphPlan> {
  const confirmed = confirmEdits(source, edits, expected);
  if (!confirmed.ok) return confirmed;
  return ok({ edits, expected });
}

function findBlock(
  model: SubgraphModel,
  subgraphId: string,
): DomainResult<SubgraphBlock> {
  const block = model.blocks.find((candidate) => candidate.id === subgraphId);
  return block === undefined
    ? refuse("targetNotFound", `no subgraph ${subgraphId}`)
    : ok(block);
}

function requireNode(
  prepared: PreparedFlowchart,
  nodeId: string,
): DomainResult<void> {
  return prepared.meaning.nodes.some((node) => node.id === nodeId)
    ? ok(undefined)
    : refuse("targetNotFound", `no node ${nodeId}`);
}

// One level deeper than the top level of the file.
function nestedIndent(prepared: PreparedFlowchart): string {
  const top = topLevelIndent(prepared.reading);
  return top === "" ? FLOWCHART_DEFAULT_INDENT : top;
}

// The indentation of the block's first statement, to copy for a new line in the block; a
// block without statements is indented one level deeper than its header.
function blockIndent(
  block: SubgraphBlock,
  prepared: PreparedFlowchart,
): string {
  const first = block.statements[0];
  if (first !== undefined) {
    return indentOfLine(prepared.reading, first.lineIndex);
  }
  return `${indentOfLine(prepared.reading, block.start.lineIndex)}${nestedIndent(prepared)}`;
}

// ---------------------------------------------------------------------------------------
// Title

export function planSetSubgraphTitle(
  source: string,
  prepared: PreparedFlowchart,
  subgraphId: string,
  title: string,
): DomainResult<SubgraphPlan> {
  const model = subgraphModelOf(prepared.reading, prepared.meaning);
  if (!model.ok) return model;
  const block = findBlock(model.value, subgraphId);
  if (!block.ok) return block;
  const encoded = encodeFlowchartLabel(title);
  if (!encoded.ok) return encoded;
  const current = block.value.start.title;
  if (current?.labelType === "markdown") {
    return refuse("markdownLabel", `${subgraphId} has a markdown title`);
  }
  const expected = withSubgraph(prepared.meaning, subgraphId, {
    title: encoded.value,
    labelType: "text",
  });
  const header = block.value.start;
  if (current === null) {
    const at = header.id.span.end;
    return planned(
      source,
      [
        {
          start: at,
          end: at,
          text: `${TITLE_OPENER}${quoted(encoded.value)}${TITLE_CLOSER}`,
        },
      ],
      expected,
    );
  }
  if (current.value === encoded.value) {
    return ok({ edits: [], expected: prepared.meaning });
  }
  const edit: TextEdit = current.quoted
    ? { ...current.content.span, text: encoded.value }
    : {
        // An unquoted title gets its quotes, and the blanks around it go.
        start: source.indexOf(TITLE_OPENER, header.id.span.end),
        end: header.span.end,
        text: `${TITLE_OPENER}${quoted(encoded.value)}${TITLE_CLOSER}`,
      };
  return planned(source, [edit], expected);
}

// ---------------------------------------------------------------------------------------
// Direction

export function planSetSubgraphDirection(
  source: string,
  prepared: PreparedFlowchart,
  subgraphId: string,
  direction: FlowchartDirection | null,
): DomainResult<SubgraphPlan> {
  const model = subgraphModelOf(prepared.reading, prepared.meaning);
  if (!model.ok) return model;
  const found = findBlock(model.value, subgraphId);
  if (!found.ok) return found;
  const block = found.value;
  const { reading, meaning } = prepared;
  const token =
    direction === null ? null : FLOWCHART_DIRECTION_WRITE_TOKENS[direction];
  if (direction !== null && token === undefined) {
    return refuse(
      "invalidDirection",
      `cannot write the direction ${direction}`,
    );
  }
  const existing = block.direction;
  if (existing === null) {
    if (token === null) return ok({ edits: [], expected: meaning });
    const indent = blockIndent(block, prepared);
    return planned(
      source,
      [
        insertLineAfterEdit(
          reading,
          block.start.lineIndex,
          `${indent}${FLOWCHART_DIRECTION_KEYWORD}${BLANK}${token}`,
        ),
      ],
      withSubgraphDirection(meaning, subgraphId, token),
    );
  }
  if (token === null) {
    const removal = removeStatements(reading, new Set([existing]));
    if (!removal.ok) return removal;
    return planned(
      source,
      [
        ...deleteLinesEdits(reading, removal.value.lines),
        ...removal.value.edits,
      ],
      withSubgraphDirection(meaning, subgraphId, null),
    );
  }
  if (
    direction !== null &&
    normalizeFlowchartDirection(existing.value) === direction
  ) {
    return ok({ edits: [], expected: meaning });
  }
  return planned(
    source,
    [{ ...existing.direction.span, text: token }],
    withSubgraphDirection(meaning, subgraphId, token),
  );
}

// ---------------------------------------------------------------------------------------
// Creating and dissolving

export function planCreateSubgraph(
  source: string,
  prepared: PreparedFlowchart,
  input: {
    readonly title: string;
    readonly id?: string;
    readonly memberId?: string;
  },
): DomainResult<SubgraphPlan> {
  const { reading, meaning } = prepared;
  const model = subgraphModelOf(reading, meaning);
  if (!model.ok) return model;
  const encoded = encodeFlowchartLabel(input.title);
  if (!encoded.ok) return encoded;
  const taken = new Set([
    ...meaning.nodes.map((node) => node.id),
    ...meaning.subgraphs.map((subgraph) => subgraph.id),
    ...meaning.edges.map((edge) => edge.id),
  ]);
  const id =
    input.id ?? generateNodeId(taken, FLOWCHART_GENERATED_SUBGRAPH_ID_PREFIX);
  const checked = validateNewNodeId(id, taken);
  if (!checked.ok) return checked;
  const memberId = input.memberId;
  if (memberId !== undefined) {
    const known = requireNode(prepared, memberId);
    if (!known.ok) return known;
  }
  const created: MentionBlock = {
    id,
    parentId: null,
    mentions: memberId === undefined ? [] : [memberId],
  };
  const members = resolveMembers([...model.value.mentionBlocks, created]);
  if (memberId !== undefined && ownerOf(members, memberId) !== id) {
    return refuse(
      "firstDefinitionWins",
      `${memberId} already belongs to ${ownerOf(members, memberId)}; a block closed earlier keeps it`,
    );
  }
  const indent = topLevelIndent(reading);
  const ending = dominantLineEnding(reading);
  const lines = [
    `${indent}${FLOWCHART_SUBGRAPH_KEYWORD}${BLANK}${id}${TITLE_OPENER}${quoted(encoded.value)}${TITLE_CLOSER}`,
    ...(memberId === undefined
      ? []
      : [`${indent}${nestedIndent(prepared)}${memberId}`]),
    `${indent}${FLOWCHART_END_KEYWORD}`,
  ];
  const expected = withMembers(
    withAppendedSubgraph(meaning, {
      id,
      title: encoded.value,
      labelType: "text",
      members: members.get(id) ?? [],
      direction: null,
      classes: [],
      statementIndex: reading.statements.length,
    }),
    members,
  );
  return planned(
    source,
    [appendLineEdit(reading, lines.join(ending))],
    expected,
  );
}

// Statements that give a block's id a meaning besides the block itself.
function referencesToSubgraph(
  prepared: PreparedFlowchart,
  subgraphId: string,
): readonly FlowchartStatement[] {
  return prepared.reading.statements.filter((statement) => {
    switch (statement.kind) {
      case "class":
      case "click":
        return statement.targets.some((target) => target.text === subgraphId);
      case "style":
        return statement.target.text === subgraphId;
      default:
        return false;
    }
  });
}

export function planDissolveSubgraph(
  source: string,
  prepared: PreparedFlowchart,
  subgraphId: string,
): DomainResult<SubgraphPlan> {
  const { reading, meaning } = prepared;
  const model = subgraphModelOf(reading, meaning);
  if (!model.ok) return model;
  const found = findBlock(model.value, subgraphId);
  if (!found.ok) return found;
  const block = found.value;
  const references = referencesToSubgraph(prepared, subgraphId);
  if (references.length > 0) {
    return refuse(
      "subgraphReferenced",
      `${subgraphId} is named by a ${references[0]?.kind} statement on line ${(references[0]?.lineIndex ?? 0) + 1}`,
    );
  }
  const own = model.value.mentionBlocks.find(
    (candidate) => candidate.id === subgraphId,
  );
  if (own === undefined) {
    return refuse("targetNotFound", `no subgraph ${subgraphId}`);
  }
  // What was written inside the block is now written in the block around it (or at the top
  // level), where the id of the dissolved block stood.
  const remaining = model.value.mentionBlocks
    .filter((candidate) => candidate.id !== subgraphId)
    .map((candidate) =>
      candidate.id === block.parentId
        ? {
            ...candidate,
            mentions: candidate.mentions.flatMap((mention) =>
              mention === subgraphId ? own.mentions : [mention],
            ),
          }
        : candidate,
    );
  const members = resolveMembers(remaining);
  const removed = new Set<FlowchartStatement>([block.start, block.end]);
  if (block.direction !== null) removed.add(block.direction);
  const removal = removeStatements(reading, removed);
  if (!removal.ok) return removal;
  const expected = withMembers(withoutSubgraph(meaning, subgraphId), members);
  const removing = [
    ...deleteLinesEdits(reading, removal.value.lines),
    ...removal.value.edits,
  ];
  return planned(
    source,
    [...removing, ...dedentEdits(prepared, block, removing)],
    expected,
  );
}

// The lines of the dissolved block move one level out: their extra indentation (the block
// content's indent beyond the header's) goes, where a line has it and no other edit touches
// the line. Leading blanks mean nothing to Mermaid, and the candidate is checked anyway.
function dedentEdits(
  prepared: PreparedFlowchart,
  block: SubgraphBlock,
  other: readonly TextEdit[],
): readonly TextEdit[] {
  const { reading } = prepared;
  const first = block.statements[0];
  if (first === undefined) return [];
  const headerIndent = indentOfLine(reading, block.start.lineIndex);
  const contentIndent = indentOfLine(reading, first.lineIndex);
  if (
    !contentIndent.startsWith(headerIndent) ||
    contentIndent.length === headerIndent.length
  ) {
    return [];
  }
  const edits: TextEdit[] = [];
  for (
    let lineIndex = block.start.lineIndex + 1;
    lineIndex < block.end.lineIndex;
    lineIndex += 1
  ) {
    const line = reading.lines[lineIndex];
    if (line === undefined || !line.text.startsWith(contentIndent)) continue;
    const touched = other.some(
      (edit) =>
        edit.start < line.end + line.terminator.length && edit.end > line.start,
    );
    if (touched) continue;
    edits.push({
      start: line.start + headerIndent.length,
      end: line.start + contentIndent.length,
      text: "",
    });
  }
  return edits;
}

// ---------------------------------------------------------------------------------------
// Membership

function membersWith(
  model: SubgraphModel,
  change: (block: MentionBlock) => MentionBlock,
): ReadonlyMap<string, readonly string[]> {
  return resolveMembers(model.mentionBlocks.map(change));
}

export function planMoveNodeToSubgraph(
  source: string,
  prepared: PreparedFlowchart,
  nodeId: string,
  subgraphId: string,
): DomainResult<SubgraphPlan> {
  const { reading, meaning } = prepared;
  const model = subgraphModelOf(reading, meaning);
  if (!model.ok) return model;
  const known = requireNode(prepared, nodeId);
  if (!known.ok) return known;
  const found = findBlock(model.value, subgraphId);
  if (!found.ok) return found;
  const block = found.value;
  if (ownerOf(model.value.members, nodeId) === subgraphId) {
    return ok({ edits: [], expected: meaning });
  }
  const members = membersWith(model.value, (candidate) =>
    candidate.id === subgraphId
      ? { ...candidate, mentions: [...candidate.mentions, nodeId] }
      : candidate,
  );
  const owner = ownerOf(members, nodeId);
  if (owner !== subgraphId) {
    return refuse(
      "firstDefinitionWins",
      `${nodeId} would stay in ${owner}: the block that closes first keeps it`,
    );
  }
  // The new mention is written before `end`; when the node was first mentioned further
  // down, it now comes first.
  const first = meaning.nodes.find((node) => node.id === nodeId);
  const position = block.end.index - HALF_STATEMENT;
  let withOrder = meaning;
  if (first !== undefined && position < first.firstMention.statementIndex) {
    const moved = withNodeFirstMention(meaning, nodeId, position);
    if (moved === null) {
      return refuse(
        "nodeOrderAmbiguous",
        `${nodeId} shares its first statement with another node`,
      );
    }
    withOrder = moved;
  }
  return planned(
    source,
    [
      insertLineBeforeEdit(
        reading,
        block.end.lineIndex,
        `${blockIndent(block, prepared)}${nodeId}`,
      ),
    ],
    withMembers(withOrder, members),
  );
}

export function planRemoveNodeFromSubgraph(
  source: string,
  prepared: PreparedFlowchart,
  nodeId: string,
  subgraphId: string,
): DomainResult<SubgraphPlan> {
  const { reading, meaning } = prepared;
  const model = subgraphModelOf(reading, meaning);
  if (!model.ok) return model;
  const known = requireNode(prepared, nodeId);
  if (!known.ok) return known;
  const found = findBlock(model.value, subgraphId);
  if (!found.ok) return found;
  const block = found.value;
  if (ownerOf(model.value.members, nodeId) !== subgraphId) {
    return refuse("notAMember", `${nodeId} is not a member of ${subgraphId}`);
  }
  // Only a statement that is nothing but the node can go; a mention inside an edge or an
  // `&` list is part of something the edit must not touch.
  const mentioning = block.statements.filter(
    (statement) =>
      (statement.kind === "node" || statement.kind === "edge") &&
      statement.groups.some((group) =>
        group.terms.some((term) => term.id.text === nodeId),
      ),
  );
  const bare: FlowchartStatement[] = [];
  for (const statement of mentioning) {
    const single =
      statement.kind === "node" &&
      statement.groups.length === 1 &&
      statement.groups[0]?.terms.length === 1;
    if (!single) {
      return refuse(
        "mentionedInStatement",
        `${nodeId} is written inside an edge or a list in ${subgraphId}`,
      );
    }
    bare.push(statement);
  }
  if (bare.length === 0) {
    return refuse("notAMember", `${nodeId} is not written in ${subgraphId}`);
  }
  const removal = removeStatements(reading, new Set(bare));
  if (!removal.ok) return removal;
  const removalEdits = [
    ...deleteLinesEdits(reading, removal.value.lines),
    ...removal.value.edits,
  ];
  // Statements that keep the node alive without the removed ones.
  const stays = reading.statements.flatMap((statement) => {
    if (bare.includes(statement)) return [];
    if (statement.kind === "style" && statement.target.text === nodeId) {
      return [statement.index];
    }
    if (
      (statement.kind === "node" || statement.kind === "edge") &&
      statement.groups.some((group) =>
        group.terms.some((term) => term.id.text === nodeId),
      )
    ) {
      return [statement.index];
    }
    return [];
  });
  const relocatedAt = block.end.index + HALF_STATEMENT;
  const plans: readonly { readonly relocate: boolean }[] =
    stays.length > 0
      ? [{ relocate: false }, { relocate: true }]
      : [{ relocate: true }];
  let lastFailure = "";
  for (const plan of plans) {
    const mentionBlocks = model.value.mentionBlocks.map((candidate) => {
      if (candidate.id === subgraphId) {
        return {
          ...candidate,
          mentions: candidate.mentions.filter((mention) => mention !== nodeId),
        };
      }
      if (plan.relocate && candidate.id === block.parentId) {
        return { ...candidate, mentions: [...candidate.mentions, nodeId] };
      }
      return candidate;
    });
    const members = resolveMembers(mentionBlocks);
    const owner = ownerOf(members, nodeId);
    if (owner !== null && owner !== block.parentId) {
      return refuse(
        "wouldJoinOther",
        `${nodeId} would become a member of ${owner}, which also mentions it`,
      );
    }
    const firstAfter = Math.min(
      ...stays,
      ...(plan.relocate ? [relocatedAt] : []),
    );
    const ordered = withNodeFirstMention(meaning, nodeId, firstAfter);
    if (ordered === null) {
      lastFailure = `nodeOrderAmbiguous: ${nodeId} shares its first statement with another node`;
      continue;
    }
    const expected = withMembers(ordered, members);
    const edits: TextEdit[] = [...removalEdits];
    if (plan.relocate) {
      const indent = indentOfLine(reading, block.start.lineIndex);
      edits.push(
        insertLineAfterEdit(
          reading,
          block.end.lineIndex,
          bare
            .map((statement) => `${indent}${statement.text}`)
            .join(dominantLineEnding(reading)),
        ),
      );
    }
    const candidate = candidateOf(source, edits, expected);
    if (candidate.ok) return ok({ edits, expected });
    lastFailure = candidate.error.detail;
  }
  return refuse("notPlainlyRemovable", lastFailure);
}
