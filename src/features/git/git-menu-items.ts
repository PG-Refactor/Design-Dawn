// The items of the commit split menu and of the header "More Actions" menu, with the rules
// that disable them (docs/ui-design.md §13.6). Pure: what an item does is passed in. Rust
// checks every rule again; these only keep the user from asking for the impossible and say
// why.

import type { GitStatus } from "../../application/ports/git-gateway";
import type {
  PopupMenuEntry,
  PopupMenuItem,
} from "../../shared/menu/popup-menu";
import type { GitCommitAction } from "./git-action-flow";
import { deriveGitChangeSections } from "./git-change-sections";
import type { GitMessages } from "./git-messages";

export interface GitMenuRunner {
  commit(action: GitCommitAction): void;
  push(): void;
  pull(): void;
  fetch(): void;
  sync(): void;
  undoLastCommit(): void;
}

export interface GitMenuContext {
  readonly messages: GitMessages;
  readonly status: GitStatus;
  // The draft message of the commit form.
  readonly message: string;
  // Another Git action runs, or the workspace is busy.
  readonly blocked: boolean;
  readonly runner: GitMenuRunner;
}

export interface GitBranchFacts {
  readonly detached: boolean;
  readonly hasHead: boolean;
  readonly headPushed: boolean;
  readonly hasUpstream: boolean;
}

export function branchFactsOf(status: GitStatus): GitBranchFacts {
  const branch = status.branch;
  return {
    detached: branch !== null && branch.head === null,
    hasHead: branch?.oid != null,
    headPushed: branch?.headPushed === true,
    hasUpstream: branch?.upstream != null,
  };
}

// Whether a non-amend commit has anything to commit: staged changes, or changes that the
// smart commit question can stage. Conflicts alone do not count.
export function hasCommittableChanges(status: GitStatus): boolean {
  return deriveGitChangeSections(status).some(
    (section) => section.id === "staged" || section.id === "changes",
  );
}

interface ItemRule {
  readonly disabled: boolean;
  readonly hint?: string;
}

const ENABLED: ItemRule = { disabled: false };

function blockedBy(reason: string | null): ItemRule {
  return reason === null ? ENABLED : { disabled: true, hint: reason };
}

function item(
  id: string,
  label: string,
  rule: ItemRule,
  blocked: boolean,
  onSelect: () => void,
): PopupMenuItem {
  return {
    id,
    label,
    disabled: rule.disabled || blocked,
    hint: rule.hint,
    onSelect,
  };
}

export function commitMenuItems(context: GitMenuContext): PopupMenuItem[] {
  const { messages, status, message, blocked, runner } = context;
  const reasons = messages.disabledReasons;
  const facts = branchFactsOf(status);
  const names = messages.commitActions;
  const plainReason = !hasCommittableChanges(status)
    ? reasons.nothingToCommit
    : message.trim() === ""
      ? reasons.messageRequired
      : null;
  const amendReason = !facts.hasHead
    ? reasons.noCommits
    : facts.headPushed
      ? reasons.alreadyPushed
      : null;
  const pushReason = facts.detached ? reasons.detached : plainReason;
  const syncReason = facts.detached
    ? reasons.detached
    : !facts.hasUpstream
      ? reasons.noUpstream
      : plainReason;
  return [
    item("commit", names.commit, blockedBy(plainReason), blocked, () =>
      runner.commit({ amend: false, followUp: "none" }),
    ),
    item("amend", names.amend, blockedBy(amendReason), blocked, () =>
      runner.commit({ amend: true, followUp: "none" }),
    ),
    item("commit-push", names.commitPush, blockedBy(pushReason), blocked, () =>
      runner.commit({ amend: false, followUp: "push" }),
    ),
    item("commit-sync", names.commitSync, blockedBy(syncReason), blocked, () =>
      runner.commit({ amend: false, followUp: "sync" }),
    ),
  ];
}

export function headerMenuEntries(context: GitMenuContext): PopupMenuEntry[] {
  const { messages, status, blocked, runner } = context;
  const reasons = messages.disabledReasons;
  const facts = branchFactsOf(status);
  const names = messages.headerActions;
  const upstreamReason = facts.detached
    ? reasons.detached
    : !facts.hasUpstream
      ? reasons.noUpstream
      : null;
  const undoReason = !facts.hasHead
    ? reasons.noCommits
    : facts.headPushed
      ? reasons.alreadyPushed
      : null;
  return [
    item("pull", names.pull, blockedBy(upstreamReason), blocked, runner.pull),
    // Without an upstream a push publishes the branch, so only a detached HEAD blocks it.
    item(
      "push",
      names.push,
      blockedBy(facts.detached ? reasons.detached : null),
      blocked,
      runner.push,
    ),
    item("fetch", names.fetch, ENABLED, blocked, runner.fetch),
    item("sync", names.sync, blockedBy(upstreamReason), blocked, runner.sync),
    { id: "separator-undo", separator: true },
    item(
      "undo-last-commit",
      names.undoLastCommit,
      blockedBy(undoReason),
      blocked,
      runner.undoLastCommit,
    ),
    { id: "separator-commit", separator: true },
    ...commitMenuItems(context),
  ];
}
