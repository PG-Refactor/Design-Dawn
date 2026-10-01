import { type Block, parseBlock, type RawBlock } from "../block/block";
import { type DisplayName, parseDisplayName } from "../shared/display-name";
import { type DomainResult, err, ok } from "../shared/domain-result";
import { type BlockId, parseSheetId, type SheetId } from "../shared/entity-id";
import type { Position, Size } from "../shared/geometry";
import { findDuplicate } from "../shared/ordered-ids";
import {
  parseSchemaVersion,
  type SchemaVersion,
} from "../shared/schema-version";

export interface Sheet {
  readonly schemaVersion: SchemaVersion;
  readonly sheetId: SheetId;
  readonly name: DisplayName;
  // Array order is z-order: first is backmost, last is frontmost.
  readonly blocks: readonly Block[];
}

export interface RawSheet {
  readonly schemaVersion: number;
  readonly sheetId: string;
  readonly name: string;
  readonly blocks: readonly RawBlock[];
}

function parseBlocks(
  rawBlocks: readonly RawBlock[],
): DomainResult<readonly Block[]> {
  const blocks: Block[] = [];
  for (const rawBlock of rawBlocks) {
    const block = parseBlock(rawBlock);
    if (!block.ok) return block;
    blocks.push(block.value);
  }
  // Checked after every element is valid so element errors take precedence.
  const duplicate = findDuplicate(blocks.map((block) => block.blockId));
  if (duplicate !== null) {
    return err("duplicateId", `duplicate blockId: ${duplicate}`);
  }
  return ok(blocks);
}

export function parseSheet(raw: RawSheet): DomainResult<Sheet> {
  const schemaVersion = parseSchemaVersion("sheet", raw.schemaVersion);
  if (!schemaVersion.ok) return schemaVersion;
  const sheetId = parseSheetId(raw.sheetId);
  if (!sheetId.ok) return sheetId;
  const name = parseDisplayName(raw.name);
  if (!name.ok) return name;
  const blocks = parseBlocks(raw.blocks);
  if (!blocks.ok) return blocks;
  return ok({
    schemaVersion: schemaVersion.value,
    sheetId: sheetId.value,
    name: name.value,
    blocks: blocks.value,
  });
}

export function renameSheet(
  sheet: Sheet,
  name: DisplayName,
): DomainResult<Sheet> {
  return ok({ ...sheet, name });
}

export function addBlock(sheet: Sheet, block: Block): DomainResult<Sheet> {
  if (sheet.blocks.some((existing) => existing.blockId === block.blockId)) {
    return err("duplicateId", `blockId already present: ${block.blockId}`);
  }
  return ok({ ...sheet, blocks: [...sheet.blocks, block] });
}

export function removeBlock(
  sheet: Sheet,
  blockId: BlockId,
): DomainResult<Sheet> {
  const index = findBlockIndex(sheet, blockId);
  if (index < 0) return blockNotFound(blockId);
  return ok({
    ...sheet,
    blocks: sheet.blocks.filter((_, current) => current !== index),
  });
}

export function setBlockPosition(
  sheet: Sheet,
  blockId: BlockId,
  position: Position,
): DomainResult<Sheet> {
  return updateBlock(sheet, blockId, (block) => ({ ...block, position }));
}

export function setBlockSize(
  sheet: Sheet,
  blockId: BlockId,
  size: Size,
): DomainResult<Sheet> {
  return updateBlock(sheet, blockId, (block) => ({ ...block, size }));
}

export function bringBlockForward(
  sheet: Sheet,
  blockId: BlockId,
): DomainResult<Sheet> {
  return bringBlocksForward(sheet, [blockId]);
}

export function sendBlockBackward(
  sheet: Sheet,
  blockId: BlockId,
): DomainResult<Sheet> {
  return sendBlocksBackward(sheet, [blockId]);
}

export function bringBlockToFront(
  sheet: Sheet,
  blockId: BlockId,
): DomainResult<Sheet> {
  return bringBlocksToFront(sheet, [blockId]);
}

export function sendBlockToBack(
  sheet: Sheet,
  blockId: BlockId,
): DomainResult<Sheet> {
  return sendBlocksToBack(sheet, [blockId]);
}

// Multi-block operations (data-model.md §13). Convention shared by all of them:
//  - all-or-nothing: an unknown id (`entityNotFound`) or a repeated id (`duplicateId`)
//    rejects the whole call and nothing changes;
//  - an operation that changes nothing returns the SAME `sheet` reference, so callers
//    (the application command layer) can detect "unchanged" with `===`.

export interface BlockFrameUpdate {
  readonly blockId: BlockId;
  readonly position: Position;
  readonly size: Size;
}

export interface BlockInsertion {
  readonly block: Block;
  // Final index in the resulting `blocks` array (not an index into the current array).
  readonly index: number;
}

export function addBlocks(
  sheet: Sheet,
  blocks: readonly Block[],
): DomainResult<Sheet> {
  if (blocks.length === 0) return ok(sheet);
  const duplicate = findDuplicate(
    [...sheet.blocks, ...blocks].map((block) => block.blockId),
  );
  if (duplicate !== null) {
    return err("duplicateId", `blockId already present: ${duplicate}`);
  }
  return ok({ ...sheet, blocks: [...sheet.blocks, ...blocks] });
}

// Re-inserts blocks at their final indexes, used to restore z-order when a deletion is
// undone. An index outside the resulting array or used twice is rejected with
// `invalidBlockIndex` (a TypeScript-only kind: `invalidPosition` means block coordinates).
export function insertBlocksAt(
  sheet: Sheet,
  insertions: readonly BlockInsertion[],
): DomainResult<Sheet> {
  if (insertions.length === 0) return ok(sheet);
  const duplicate = findDuplicate([
    ...sheet.blocks.map((block) => block.blockId),
    ...insertions.map((insertion) => insertion.block.blockId),
  ]);
  if (duplicate !== null) {
    return err("duplicateId", `blockId already present: ${duplicate}`);
  }
  const total = sheet.blocks.length + insertions.length;
  const slots = new Map<number, Block>();
  for (const { block, index } of insertions) {
    if (!Number.isInteger(index) || index < 0 || index >= total) {
      return err(
        "invalidBlockIndex",
        `insertion index ${index} is outside 0..${total - 1}`,
      );
    }
    if (slots.has(index)) {
      return err("invalidBlockIndex", `insertion index used twice: ${index}`);
    }
    slots.set(index, block);
  }
  const remaining = [...sheet.blocks];
  const blocks: Block[] = [];
  let nextRemaining = 0;
  for (let index = 0; index < total; index += 1) {
    const block = slots.get(index) ?? remaining[nextRemaining++];
    // Unreachable: slot count + remaining count equals `total` by construction.
    if (block === undefined) {
      return err("invalidBlockIndex", "insertion left a gap");
    }
    blocks.push(block);
  }
  return ok({ ...sheet, blocks });
}

export function removeBlocks(
  sheet: Sheet,
  blockIds: readonly BlockId[],
): DomainResult<Sheet> {
  if (blockIds.length === 0) return ok(sheet);
  const targets = ensureTargets(sheet, blockIds);
  if (!targets.ok) return targets;
  return ok({
    ...sheet,
    blocks: sheet.blocks.filter((block) => !targets.value.has(block.blockId)),
  });
}

export function setBlockFrames(
  sheet: Sheet,
  updates: readonly BlockFrameUpdate[],
): DomainResult<Sheet> {
  const targets = ensureTargets(
    sheet,
    updates.map((update) => update.blockId),
  );
  if (!targets.ok) return targets;
  const updateById = new Map(updates.map((update) => [update.blockId, update]));
  let changed = false;
  const blocks = sheet.blocks.map((block) => {
    const update = updateById.get(block.blockId);
    if (update === undefined || hasFrame(block, update)) return block;
    changed = true;
    return { ...block, position: update.position, size: update.size };
  });
  return ok(changed ? { ...sheet, blocks } : sheet);
}

export function bringBlocksToFront(
  sheet: Sheet,
  blockIds: readonly BlockId[],
): DomainResult<Sheet> {
  return rearrange(sheet, blockIds, (blocks, isTarget) => [
    ...blocks.filter((block) => !isTarget(block)),
    ...blocks.filter(isTarget),
  ]);
}

export function sendBlocksToBack(
  sheet: Sheet,
  blockIds: readonly BlockId[],
): DomainResult<Sheet> {
  return rearrange(sheet, blockIds, (blocks, isTarget) => [
    ...blocks.filter(isTarget),
    ...blocks.filter((block) => !isTarget(block)),
  ]);
}

// Each target swaps with the non-target directly in front of it; a contiguous group
// already at the front stays where it is.
export function bringBlocksForward(
  sheet: Sheet,
  blockIds: readonly BlockId[],
): DomainResult<Sheet> {
  return rearrange(sheet, blockIds, (blocks, isTarget) =>
    swapTargetsWithNeighbours(blocks, isTarget, 1),
  );
}

export function sendBlocksBackward(
  sheet: Sheet,
  blockIds: readonly BlockId[],
): DomainResult<Sheet> {
  return rearrange(sheet, blockIds, (blocks, isTarget) =>
    swapTargetsWithNeighbours(blocks, isTarget, -1),
  );
}

// Sets the exact z-order. `orderedBlockIds` must be a permutation of the current ids.
export function reorderBlocks(
  sheet: Sheet,
  orderedBlockIds: readonly BlockId[],
): DomainResult<Sheet> {
  const targets = ensureTargets(sheet, orderedBlockIds);
  if (!targets.ok) return targets;
  if (orderedBlockIds.length !== sheet.blocks.length) {
    return err(
      "entityNotFound",
      `order lists ${orderedBlockIds.length} of ${sheet.blocks.length} blocks`,
    );
  }
  const blockById = new Map(
    sheet.blocks.map((block) => [block.blockId, block]),
  );
  const blocks: Block[] = [];
  for (const blockId of orderedBlockIds) {
    const block = blockById.get(blockId);
    if (block === undefined) return blockNotFound(blockId);
    blocks.push(block);
  }
  return ok(withBlocks(sheet, blocks));
}

function hasFrame(block: Block, frame: BlockFrameUpdate): boolean {
  return (
    block.position.x === frame.position.x &&
    block.position.y === frame.position.y &&
    block.size.width === frame.size.width &&
    block.size.height === frame.size.height
  );
}

function sameBlocks(
  first: readonly Block[],
  second: readonly Block[],
): boolean {
  return (
    first.length === second.length &&
    first.every((block, index) => block === second[index])
  );
}

function withBlocks(sheet: Sheet, blocks: readonly Block[]): Sheet {
  return sameBlocks(sheet.blocks, blocks) ? sheet : { ...sheet, blocks };
}

function ensureTargets(
  sheet: Sheet,
  blockIds: readonly BlockId[],
): DomainResult<ReadonlySet<BlockId>> {
  const duplicate = findDuplicate(blockIds);
  if (duplicate !== null) {
    return err("duplicateId", `duplicate blockId: ${duplicate}`);
  }
  const present = new Set(sheet.blocks.map((block) => block.blockId));
  const missing = blockIds.find((blockId) => !present.has(blockId));
  if (missing !== undefined) return blockNotFound(missing);
  return ok(new Set(blockIds));
}

function rearrange(
  sheet: Sheet,
  blockIds: readonly BlockId[],
  arrange: (
    blocks: readonly Block[],
    isTarget: (block: Block) => boolean,
  ) => readonly Block[],
): DomainResult<Sheet> {
  const targets = ensureTargets(sheet, blockIds);
  if (!targets.ok) return targets;
  const blocks = arrange(sheet.blocks, (block) =>
    targets.value.has(block.blockId),
  );
  return ok(withBlocks(sheet, blocks));
}

// Sweeping from the leading edge of the movement keeps a contiguous group together:
// the block at the edge swaps first, then the next one swaps into the gap it left.
function swapTargetsWithNeighbours(
  blocks: readonly Block[],
  isTarget: (block: Block) => boolean,
  direction: 1 | -1,
): readonly Block[] {
  const result = [...blocks];
  for (let step = 0; step < result.length - 1; step += 1) {
    const index = direction === 1 ? result.length - 2 - step : step + 1;
    const block = result[index];
    const neighbour = result[index + direction];
    if (
      block !== undefined &&
      neighbour !== undefined &&
      isTarget(block) &&
      !isTarget(neighbour)
    ) {
      result[index] = neighbour;
      result[index + direction] = block;
    }
  }
  return result;
}

function findBlockIndex(sheet: Sheet, blockId: BlockId): number {
  return sheet.blocks.findIndex((block) => block.blockId === blockId);
}

function blockNotFound<T = never>(blockId: BlockId): DomainResult<T> {
  return err("entityNotFound", `block not found: ${blockId}`);
}

function updateBlock(
  sheet: Sheet,
  blockId: BlockId,
  update: (block: Block) => Block,
): DomainResult<Sheet> {
  const index = findBlockIndex(sheet, blockId);
  if (index < 0) return blockNotFound(blockId);
  return ok({
    ...sheet,
    blocks: sheet.blocks.map((block, current) =>
      current === index ? update(block) : block,
    ),
  });
}
