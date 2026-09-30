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
  return shiftBlock(sheet, blockId, 1);
}

export function sendBlockBackward(
  sheet: Sheet,
  blockId: BlockId,
): DomainResult<Sheet> {
  return shiftBlock(sheet, blockId, -1);
}

export function bringBlockToFront(
  sheet: Sheet,
  blockId: BlockId,
): DomainResult<Sheet> {
  return relocateBlock(sheet, blockId, (others) => others.length);
}

export function sendBlockToBack(
  sheet: Sheet,
  blockId: BlockId,
): DomainResult<Sheet> {
  return relocateBlock(sheet, blockId, () => 0);
}

function findBlockIndex(sheet: Sheet, blockId: BlockId): number {
  return sheet.blocks.findIndex((block) => block.blockId === blockId);
}

function blockNotFound(blockId: BlockId): DomainResult<Sheet> {
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

// Removes the block and re-inserts it where `insertIndex` says, relative to the remaining blocks.
function relocateBlock(
  sheet: Sheet,
  blockId: BlockId,
  insertIndex: (others: readonly Block[]) => number,
): DomainResult<Sheet> {
  const index = findBlockIndex(sheet, blockId);
  const block = sheet.blocks[index];
  if (block === undefined) return blockNotFound(blockId);
  const others = sheet.blocks.filter((_, current) => current !== index);
  const target = insertIndex(others);
  return ok({
    ...sheet,
    blocks: [...others.slice(0, target), block, ...others.slice(target)],
  });
}

// Moving past either end is a no-op rather than an error (data-model.md §13).
function shiftBlock(
  sheet: Sheet,
  blockId: BlockId,
  offset: 1 | -1,
): DomainResult<Sheet> {
  const index = findBlockIndex(sheet, blockId);
  if (index < 0) return blockNotFound(blockId);
  const target = Math.min(Math.max(index + offset, 0), sheet.blocks.length - 1);
  return relocateBlock(sheet, blockId, () => target);
}
