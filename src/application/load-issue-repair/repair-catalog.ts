// Which repair actions the UI offers for each kind of Load Issue (docs/architecture.md
// §14.15). The list only decides which buttons appear; Rust refuses an action that does not
// fit the issue, and says why one that fits cannot be done safely.

import type { LoadIssueKind, RepairAction } from "../ports/persistence-types";

export const REPAIR_ACTIONS_BY_ISSUE_KIND: Readonly<
  Record<LoadIssueKind, readonly RepairAction[]>
> = {
  unlistedEntity: ["addToList"],
  missingEntity: ["removeFromList"],
  invalidOrderEntry: ["removeFromList"],
  duplicateEntityId: ["giveNewId"],
  // No automatic repair: the file itself is unreadable. The path is shown and the files
  // can be read again.
  entityLoadFailed: [],
  missingContent: ["createEmptyContent", "removeBlock"],
  orphanContent: ["addAsBlock", "deleteFile"],
  leftoverTempFile: ["deleteTempFile"],
  unrecognizedDirectory: [],
  // Not a problem to repair one by one: "update all now" writes all of them.
  outdatedFormat: [],
};

// Issues the user can only look at and read the files again for.
export const RELOAD_ONLY_ISSUE_KINDS: readonly LoadIssueKind[] = [
  "entityLoadFailed",
  "unrecognizedDirectory",
];

// Actions that delete a file or a Block's reference to it; their dialog says so.
export const DESTRUCTIVE_REPAIR_ACTIONS: readonly RepairAction[] = [
  "removeBlock",
  "deleteFile",
  "deleteTempFile",
];
