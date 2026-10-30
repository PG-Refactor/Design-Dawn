import { type DomainResult, ok } from "../../shared/domain-result";
import type { FlowchartMeaning } from "./flowchart-meaning";
import { refuse } from "./flowchart-operation-support";
import type { FlowchartReading } from "./flowchart-reader";
import type {
  FlowchartStatement,
  FlowchartSubgraphDirectionStatement,
  FlowchartSubgraphEndStatement,
  FlowchartSubgraphStartStatement,
} from "./flowchart-types";

// The subgraph blocks of a text and the rule that turns what is written inside them into
// members (docs/architecture.md §16.15.14). The membership operations change the list of
// mentions of a block and ask `resolveMembers` what Mermaid will then make of it, so the
// meaning they promise does not depend on the text they produce.

export interface SubgraphBlock {
  readonly id: string;
  readonly start: FlowchartSubgraphStartStatement;
  readonly end: FlowchartSubgraphEndStatement;
  readonly direction: FlowchartSubgraphDirectionStatement | null;
  readonly parentId: string | null;
  // The statements written directly in the block: nested blocks (their `subgraph` and `end`
  // lines and everything between) are not part of it.
  readonly statements: readonly FlowchartStatement[];
}

// What Mermaid lists as the members of a block before it applies "the first definition
// wins": every node id written in a statement of the block, the id of an edge whose
// attribute line is in the block, and the id of every block closed inside it.
export interface MentionBlock {
  readonly id: string;
  readonly parentId: string | null;
  readonly mentions: readonly string[];
}

function mentionsOfStatement(statement: FlowchartStatement): readonly string[] {
  switch (statement.kind) {
    case "node":
    case "edge":
      return statement.groups.flatMap((group) =>
        group.terms.map((term) => term.id.text),
      );
    case "edgeAttributes":
      return [statement.id.text];
    default:
      return [];
  }
}

interface OpenBlock {
  readonly start: FlowchartSubgraphStartStatement;
  readonly parentId: string | null;
  direction: FlowchartSubgraphDirectionStatement | null;
  readonly statements: FlowchartStatement[];
}

// The blocks in the order they close (inner before outer, which is also the order of
// `meaning.subgraphs`), with their mentions.
export function readSubgraphBlocks(reading: FlowchartReading): {
  readonly blocks: readonly SubgraphBlock[];
  readonly mentionBlocks: readonly MentionBlock[];
} {
  const blocks: SubgraphBlock[] = [];
  const mentionBlocks: MentionBlock[] = [];
  const open: OpenBlock[] = [];
  const openMentions: string[][] = [];
  for (const statement of reading.statements) {
    const top = open[open.length - 1];
    if (statement.kind === "subgraphStart") {
      open.push({
        start: statement,
        parentId: top?.start.id.text ?? null,
        direction: null,
        statements: [],
      });
      openMentions.push([]);
      continue;
    }
    if (statement.kind === "subgraphEnd") {
      const closed = open.pop();
      const mentions = openMentions.pop();
      if (closed === undefined || mentions === undefined) continue;
      const id = closed.start.id.text;
      blocks.push({
        id,
        start: closed.start,
        end: statement,
        direction: closed.direction,
        parentId: closed.parentId,
        statements: closed.statements,
      });
      mentionBlocks.push({ id, parentId: closed.parentId, mentions });
      openMentions[openMentions.length - 1]?.push(id);
      continue;
    }
    if (top === undefined) continue;
    if (statement.kind === "subgraphDirection") top.direction = statement;
    top.statements.push(statement);
    openMentions[openMentions.length - 1]?.push(
      ...mentionsOfStatement(statement),
    );
  }
  return { blocks, mentionBlocks };
}

// Mermaid's rule when a block closes: a mention counts once, never for the block's own id,
// and not when a block that closed earlier already has it. `blocks` are in closing order.
export function resolveMembers(
  blocks: readonly MentionBlock[],
): ReadonlyMap<string, readonly string[]> {
  const resolved = new Map<string, readonly string[]>();
  for (const block of blocks) {
    const members: string[] = [];
    for (const mention of block.mentions) {
      if (mention.trim() === "" || members.includes(mention)) continue;
      if (mention === block.id) continue;
      if ([...resolved.values()].some((other) => other.includes(mention))) {
        continue;
      }
      members.push(mention);
    }
    resolved.set(block.id, members);
  }
  return resolved;
}

// The block that owns a node (the one whose members include it), or null.
export function ownerOf(
  members: ReadonlyMap<string, readonly string[]>,
  nodeId: string,
): string | null {
  for (const [id, list] of members) {
    if (list.includes(nodeId)) return id;
  }
  return null;
}

export interface SubgraphModel {
  readonly blocks: readonly SubgraphBlock[];
  readonly mentionBlocks: readonly MentionBlock[];
  readonly members: ReadonlyMap<string, readonly string[]>;
}

// Reads the blocks and checks that the rule above gives the members the reader found. If it
// does not, the model cannot be trusted to predict an edit and the operation is refused.
export function subgraphModelOf(
  reading: FlowchartReading,
  meaning: FlowchartMeaning,
): DomainResult<SubgraphModel> {
  const { blocks, mentionBlocks } = readSubgraphBlocks(reading);
  const members = resolveMembers(mentionBlocks);
  const agrees =
    blocks.length === meaning.subgraphs.length &&
    meaning.subgraphs.every((subgraph, position) => {
      const resolved = members.get(subgraph.id);
      return (
        blocks[position]?.id === subgraph.id &&
        resolved !== undefined &&
        [...resolved].sort().join("\u0000") ===
          [...subgraph.members].sort().join("\u0000")
      );
    });
  if (!agrees) {
    return refuse(
      "subgraphModelMismatch",
      "the subgraph blocks could not be matched to what the reader found",
    );
  }
  return ok({ blocks, mentionBlocks, members });
}
