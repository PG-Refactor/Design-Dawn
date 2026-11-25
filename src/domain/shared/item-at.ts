// The item at `index`, or `fallback` when there is none. For an index the code knows is in
// range (a column of a padded row, the line a caret was found on) where the type checker
// still asks what an absent item would be: one place answers that, instead of a fallback
// at every lookup.
export function itemAt<Item>(
  items: ArrayLike<Item>,
  index: number,
  fallback: Item,
): Item {
  return items[index] ?? fallback;
}
