// Queries for the Git change tree in DOM tests. The tree is flat (section headers and file
// rows are siblings), so a row belongs to the closest header before it.
import { screen, within } from "@testing-library/react";

const TITLE_SELECTOR = ".git-section-header__title";

function treeItems(): HTMLElement[] {
  return within(screen.getByRole("tree")).getAllByRole("treeitem");
}

function titleOf(header: HTMLElement): string {
  return header.querySelector(TITLE_SELECTOR)?.textContent ?? "";
}

// The header treeitem of a section, by its title.
export function headerOf(title: string): HTMLElement {
  const header = treeItems().find(
    (item) =>
      item.getAttribute("aria-level") === "1" && titleOf(item) === title,
  );
  if (header === undefined) throw new Error(`No section header "${title}"`);
  return header;
}

export function hasHeader(title: string): boolean {
  return (
    screen.queryByRole("tree") !== null &&
    treeItems().some(
      (item) =>
        item.getAttribute("aria-level") === "1" && titleOf(item) === title,
    )
  );
}

// The file rows of a section, in order (none when it is collapsed).
export function rowsOf(title: string): HTMLElement[] {
  const rows: HTMLElement[] = [];
  let inside = false;
  for (const item of treeItems()) {
    if (item.getAttribute("aria-level") === "1") {
      inside = titleOf(item) === title;
    } else if (inside) {
      rows.push(item);
    }
  }
  return rows;
}

// A file row of a section, by its accessible name ("<kind label> <path>").
export function rowOf(title: string, name: string): HTMLElement {
  const row = rowsOf(title).find(
    (item) => item.getAttribute("aria-label") === name,
  );
  if (row === undefined) throw new Error(`No row "${name}" in "${title}"`);
  return row;
}

export function rowCountOf(title: string): number {
  return rowsOf(title).length;
}

export function sectionTitles(): string[] {
  if (screen.queryByRole("tree") === null) return [];
  return treeItems()
    .filter((item) => item.getAttribute("aria-level") === "1")
    .map(titleOf);
}
