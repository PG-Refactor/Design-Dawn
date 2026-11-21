// What changed between two versions of a Sheet, Block by Block, for showing the two side by
// side: Blocks only in the later version are added, only in the earlier one removed; a
// Block in both is moved when its place or size changed, and changed when its text, its
// picture, its display size, its caption or its place in the stacking order changed.

import type { Block } from "../../domain/block/block";
import { blockDisplayOf } from "../../domain/block/content-scale";
import type { BlockId } from "../../domain/shared/entity-id";
import type { Sheet } from "../../domain/sheet/sheet";
import type { GitSheetVersion } from "../ports/git-gateway";

export type BlockChangeKind = "added" | "removed" | "changed";

export interface BlockChange {
  readonly blockId: BlockId;
  readonly kind: BlockChangeKind;
  // For a Block in both versions: what is different.
  readonly moved: boolean;
  readonly resized: boolean;
  readonly content: boolean;
  readonly display: boolean;
  readonly caption: boolean;
  readonly order: boolean;
}

export interface SheetComparison {
  // In the order of the later version, then the removed ones in the earlier order.
  readonly changes: readonly BlockChange[];
  readonly counts: {
    readonly added: number;
    readonly removed: number;
    readonly moved: number;
    readonly changed: number;
  };
}

const NOTHING = {
  moved: false,
  resized: false,
  content: false,
  display: false,
  caption: false,
  order: false,
} as const;

function contentOf(
  version: GitSheetVersion | null,
  block: Block,
): string | undefined {
  if (version === null) return undefined;
  return version.texts[block.contentPath] ?? version.images[block.contentPath];
}

function sameDisplay(first: Block, second: Block): boolean {
  const a = blockDisplayOf(first);
  const b = blockDisplayOf(second);
  return a.scalePercent === b.scalePercent && a.autoFit === b.autoFit;
}

// The Blocks whose place in the stacking order changed: of the Blocks both versions have,
// the fewest that, moved, turn the earlier order into the later one. The others keep their
// order (the longest run of them in the same order), so bringing one Block to the front
// marks that Block only, not every Block it passed.
function reordered(
  beforeBlocks: readonly Block[],
  afterBlocks: readonly Block[],
  shared: ReadonlySet<BlockId>,
): ReadonlySet<BlockId> {
  const beforeIndex = new Map(
    beforeBlocks
      .filter((block) => shared.has(block.blockId))
      .map((block, index) => [block.blockId, index]),
  );
  const order = afterBlocks
    .filter((block) => shared.has(block.blockId))
    .map((block) => ({
      blockId: block.blockId,
      index: beforeIndex.get(block.blockId) ?? 0,
    }));
  // Longest increasing run of earlier indices (patience sorting, with back links).
  const tails: number[] = [];
  const previous: number[] = new Array(order.length).fill(-1);
  for (let position = 0; position < order.length; position += 1) {
    const value = order[position]?.index ?? 0;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      const tail = tails[middle] ?? 0;
      if ((order[tail]?.index ?? 0) < value) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[position] = tails[low - 1] ?? -1;
    tails[low] = position;
  }
  const kept = new Set<BlockId>();
  let position = tails[tails.length - 1] ?? -1;
  while (position >= 0) {
    const entry = order[position];
    if (entry !== undefined) kept.add(entry.blockId);
    position = previous[position] ?? -1;
  }
  return new Set(
    order.map((entry) => entry.blockId).filter((blockId) => !kept.has(blockId)),
  );
}

export function compareSheetVersions(
  before: GitSheetVersion | null,
  after: GitSheetVersion | null,
): SheetComparison {
  const beforeBlocks: readonly Block[] = before?.sheet?.blocks ?? [];
  const afterBlocks: readonly Block[] = after?.sheet?.blocks ?? [];
  const beforeById = new Map(
    beforeBlocks.map((block) => [block.blockId, block]),
  );
  const afterIds = new Set(afterBlocks.map((block) => block.blockId));
  const shared = new Set(
    afterBlocks
      .map((block) => block.blockId)
      .filter((blockId) => beforeById.has(blockId)),
  );
  const movedInOrder = reordered(beforeBlocks, afterBlocks, shared);
  const changes: BlockChange[] = [];
  for (const block of afterBlocks) {
    const earlier = beforeById.get(block.blockId);
    if (earlier === undefined) {
      changes.push({ blockId: block.blockId, kind: "added", ...NOTHING });
      continue;
    }
    const change = {
      moved:
        earlier.position.x !== block.position.x ||
        earlier.position.y !== block.position.y,
      resized:
        earlier.size.width !== block.size.width ||
        earlier.size.height !== block.size.height,
      content:
        earlier.contentPath !== block.contentPath ||
        contentOf(before, earlier) !== contentOf(after, block),
      display: !sameDisplay(earlier, block),
      caption:
        earlier.caption !== block.caption ||
        earlier.captionPosition !== block.captionPosition,
      order: movedInOrder.has(block.blockId),
    };
    if (Object.values(change).some(Boolean)) {
      changes.push({ blockId: block.blockId, kind: "changed", ...change });
    }
  }
  for (const block of beforeBlocks) {
    if (!afterIds.has(block.blockId)) {
      changes.push({ blockId: block.blockId, kind: "removed", ...NOTHING });
    }
  }
  const isMoved = (change: BlockChange) => change.moved || change.resized;
  const isChanged = (change: BlockChange) =>
    change.content || change.display || change.caption || change.order;
  return {
    changes,
    counts: {
      added: changes.filter((change) => change.kind === "added").length,
      removed: changes.filter((change) => change.kind === "removed").length,
      moved: changes.filter(isMoved).length,
      changed: changes.filter(isChanged).length,
    },
  };
}

// The Block the app should go to for a changed file: the Block that shows that file, or
// else the first changed Block that still exists; null when there is none (the Sheet is
// then only opened).
export function blockToReveal(
  comparison: SheetComparison,
  after: Sheet | null,
  documentRelativePath: string | null,
): BlockId | null {
  if (after === null) return null;
  const shown =
    documentRelativePath === null
      ? undefined
      : after.blocks.find(
          (block) => block.contentPath === documentRelativePath,
        );
  if (shown !== undefined) return shown.blockId;
  const first = comparison.changes.find((change) => change.kind !== "removed");
  return first?.blockId ?? null;
}
