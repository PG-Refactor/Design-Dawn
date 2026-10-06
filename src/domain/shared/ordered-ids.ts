import { type DomainResult, err, ok } from "./domain-result";
import { type EntryId, parseEntryId } from "./entity-id";

// Shared by Project.childOrder, Folder.childOrder and Document.sheetOrder. Operations address
// entries by ID, never by numeric index, so callers cannot produce out-of-range errors.

export function findDuplicate<Id extends string>(
  ids: readonly Id[],
): Id | null {
  const seen = new Set<Id>();
  for (const id of ids) {
    if (seen.has(id)) {
      return id;
    }
    seen.add(id);
  }
  return null;
}

export function ensureUniqueIds<Id extends string>(
  ids: readonly Id[],
): DomainResult<readonly Id[]> {
  const duplicate = findDuplicate(ids);
  if (duplicate !== null) {
    return err("duplicateId", `duplicate id: ${duplicate}`);
  }
  return ok(ids);
}

export function addToOrder<Id extends string>(
  order: readonly Id[],
  id: Id,
): DomainResult<readonly Id[]> {
  if (order.includes(id)) {
    return err("duplicateId", `already present: ${id}`);
  }
  return ok([...order, id]);
}

export function removeFromOrder<Id extends string>(
  order: readonly Id[],
  id: Id,
): DomainResult<readonly Id[]> {
  if (!order.includes(id)) {
    return err("entityNotFound", `not found: ${id}`);
  }
  return ok(order.filter((candidate) => candidate !== id));
}

// Moves `id` directly before `beforeId`, or to the end when `beforeId` is null.
export function moveInOrder<Id extends string>(
  order: readonly Id[],
  id: Id,
  beforeId: Id | null,
): DomainResult<readonly Id[]> {
  if (!order.includes(id)) {
    return err("entityNotFound", `not found: ${id}`);
  }
  if (beforeId !== null && !order.includes(beforeId)) {
    return err("entityNotFound", `not found: ${beforeId}`);
  }
  if (id === beforeId) {
    return ok(order);
  }
  const remaining = order.filter((candidate) => candidate !== id);
  const insertIndex =
    beforeId === null ? remaining.length : remaining.indexOf(beforeId);
  return ok([
    ...remaining.slice(0, insertIndex),
    id,
    ...remaining.slice(insertIndex),
  ]);
}

// Parses a `childOrder`. Every element is parsed first so an invalid ID wins over a
// duplicate, like the Rust domain.
export function parseChildOrder(
  rawIds: readonly string[],
  ownerLabel: string,
): DomainResult<readonly EntryId[]> {
  const ids: EntryId[] = [];
  for (const rawId of rawIds) {
    const id = parseEntryId(rawId);
    if (!id.ok) return id;
    ids.push(id.value);
  }
  const duplicate = findDuplicate(ids);
  if (duplicate !== null) {
    return err("duplicateId", `duplicate id in ${ownerLabel}: ${duplicate}`);
  }
  return ok(ids);
}
