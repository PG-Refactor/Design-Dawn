// Sorts the files of a Git status into the sections of the change list
// (docs/ui-design.md §13.2). Git's answer is classified as it is; nothing is inferred.

import type {
  GitFileChange,
  GitFileStatus,
  GitStatus,
} from "../../application/ports/git-gateway";
import type { GitSelectionSide } from "../workspace/ui-state/ui-state";

// Display order.
export const GIT_CHANGE_SECTION_IDS = [
  "staged",
  "changes",
  "untracked",
  "conflicts",
] as const;

export type GitChangeSectionId = (typeof GIT_CHANGE_SECTION_IDS)[number];

const STAGED_CHANGES: ReadonlySet<GitFileChange> = new Set([
  "modified",
  "added",
  "deleted",
  "renamed",
  "copied",
  "typeChanged",
]);

const UNSTAGED_CHANGES: ReadonlySet<GitFileChange> = new Set([
  "modified",
  "deleted",
  "typeChanged",
]);

export interface GitChangeEntry {
  // Unique in the list: a partly staged file is in two sections.
  readonly key: string;
  readonly sectionId: GitChangeSectionId;
  readonly path: string;
  // Only for a renamed / copied file of the staged section (git reports it on the index side).
  readonly originalPath: string | null;
  // The change on the side the section represents.
  readonly change: GitFileChange;
  // Null for conflicts: no diff is offered for them, so they cannot be selected.
  readonly selectionSide: GitSelectionSide | null;
}

export interface GitChangeSection {
  readonly id: GitChangeSectionId;
  readonly entries: readonly GitChangeEntry[];
}

function entryOf(
  sectionId: GitChangeSectionId,
  file: GitFileStatus,
  change: GitFileChange,
  selectionSide: GitSelectionSide | null,
  originalPath: string | null,
): GitChangeEntry {
  return {
    key: `${sectionId}:${file.path}`,
    sectionId,
    path: file.path,
    originalPath,
    change,
    selectionSide,
  };
}

// Only the sections that have entries, in display order.
export function deriveGitChangeSections(
  status: GitStatus,
): readonly GitChangeSection[] {
  const entries: Record<GitChangeSectionId, GitChangeEntry[]> = {
    staged: [],
    changes: [],
    untracked: [],
    conflicts: [],
  };
  for (const file of status.files) {
    const { indexStatus, worktreeStatus } = file;
    if (indexStatus === "unmerged" || worktreeStatus === "unmerged") {
      entries.conflicts.push(
        entryOf("conflicts", file, "unmerged", null, null),
      );
      continue;
    }
    if (indexStatus === "untracked" || worktreeStatus === "untracked") {
      entries.untracked.push(
        entryOf("untracked", file, "untracked", "unstaged", null),
      );
      continue;
    }
    if (STAGED_CHANGES.has(indexStatus)) {
      const renamedOrCopied =
        indexStatus === "renamed" || indexStatus === "copied";
      entries.staged.push(
        entryOf(
          "staged",
          file,
          indexStatus,
          "staged",
          renamedOrCopied ? file.originalPath : null,
        ),
      );
    }
    if (UNSTAGED_CHANGES.has(worktreeStatus)) {
      entries.changes.push(
        entryOf("changes", file, worktreeStatus, "unstaged", null),
      );
    }
  }
  return GIT_CHANGE_SECTION_IDS.filter((id) => entries[id].length > 0).map(
    (id) => ({ id, entries: entries[id] }),
  );
}

function sectionOrder(sectionId: GitChangeSectionId): number {
  return GIT_CHANGE_SECTION_IDS.indexOf(sectionId);
}

function flatten(sections: readonly GitChangeSection[]): GitChangeEntry[] {
  return sections.flatMap((section) => section.entries);
}

// Where the focus goes after a Stage / Unstage changed the list: the same row of the same
// section if it is still there, else the next row of that section, else the first row of a
// later section, else the last row (the previous one). Null: no row is left, the caller
// focuses the heading. `before` is the list the operation was started from.
export function focusKeyAfterChange(
  before: readonly GitChangeSection[],
  after: readonly GitChangeSection[],
  actedKey: string,
): string | null {
  const afterEntries = flatten(after);
  const remaining = new Set(afterEntries.map((entry) => entry.key));
  if (remaining.has(actedKey)) return actedKey;
  const acted = flatten(before).find((entry) => entry.key === actedKey);
  if (acted === undefined) return afterEntries.at(-1)?.key ?? null;
  const sectionBefore =
    before.find((section) => section.id === acted.sectionId)?.entries ?? [];
  const next = sectionBefore
    .slice(sectionBefore.findIndex((entry) => entry.key === actedKey) + 1)
    .find((entry) => remaining.has(entry.key));
  if (next !== undefined) return next.key;
  const actedOrder = sectionOrder(acted.sectionId);
  const later = after.find((section) => sectionOrder(section.id) > actedOrder);
  if (later !== undefined) return later.entries[0]?.key ?? null;
  return afterEntries.at(-1)?.key ?? null;
}
