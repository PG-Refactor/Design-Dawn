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

// The ids of the Blocks both versions have, in each version's stacking order: a Block has
// changed place in the order when it is at another index among those.
function sharedOrder(
  blocks: readonly Block[],
  shared: ReadonlySet<BlockId>,
): readonly BlockId[] {
  return blocks
    .filter((block) => shared.has(block.blockId))
    .map((block) => block.blockId);
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
  const beforeOrder = sharedOrder(beforeBlocks, shared);
  const afterOrder = sharedOrder(afterBlocks, shared);
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
      order:
        beforeOrder.indexOf(block.blockId) !==
        afterOrder.indexOf(block.blockId),
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
