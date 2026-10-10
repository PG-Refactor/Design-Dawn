// Port for the Project's Git state (docs/git-development.md §11). Git is read through the
// Rust side only; the Frontend never sees a path of the machine, git's raw status codes
// or its stderr. The values below are the wire identifiers Rust sends.

import type { ProjectId } from "../../domain/shared/entity-id";
import type { GIT_ERROR_KINDS, OperationResult } from "./operation-error";

// Anything but `ready` is a normal answer (the app works without Git), not an error.
export const GIT_REPOSITORY_STATES = [
  "ready",
  "notRepository",
  "unsupportedRepositoryLayout",
  "gitUnavailable",
  "error",
] as const;

export type GitRepositoryState = (typeof GIT_REPOSITORY_STATES)[number];

export const GIT_FILE_CHANGES = [
  "unmodified",
  "modified",
  "added",
  "deleted",
  "renamed",
  "copied",
  "typeChanged",
  "untracked",
  "ignored",
  "unmerged",
] as const;

export type GitFileChange = (typeof GIT_FILE_CHANGES)[number];

export interface GitFileStatus {
  // Project root relative, `/` separated.
  readonly path: string;
  readonly indexStatus: GitFileChange;
  readonly worktreeStatus: GitFileChange;
  // Only for renamed / copied files.
  readonly originalPath: string | null;
}

export interface GitBranchInfo {
  // Branch name; null on a detached HEAD. Untrusted text: render it as text only.
  readonly head: string | null;
  // Commit id of HEAD; null on an unborn branch (no commit yet).
  readonly oid: string | null;
}

export interface GitStatus {
  readonly repositoryState: GitRepositoryState;
  // Null unless the repository state is `ready`.
  readonly branch: GitBranchInfo | null;
  // Empty unless the repository state is `ready`.
  readonly files: readonly GitFileStatus[];
}

export const GIT_DIFF_SIDES = ["unstaged", "staged"] as const;

// `unstaged`: working tree against the index; `staged`: index against HEAD.
export type GitDiffSide = (typeof GIT_DIFF_SIDES)[number];

export const GIT_DIFF_OUTCOMES = [
  "text",
  "empty",
  "untracked",
  "binary",
  "tooLarge",
  "notUtf8",
] as const;

export type GitDiffOutcome = (typeof GIT_DIFF_OUTCOMES)[number];

// Every outcome is a result, not a failure (docs/git-development.md §11.10).
export type GitDiffContent =
  | { readonly outcome: "text"; readonly diff: string }
  | { readonly outcome: "empty" }
  | { readonly outcome: "untracked" }
  | { readonly outcome: "binary" }
  | { readonly outcome: "tooLarge"; readonly limitBytes: number }
  | { readonly outcome: "notUtf8" };

export type GitDiff = {
  // Project root relative, `/` separated.
  readonly path: string;
  readonly side: GitDiffSide;
} & GitDiffContent;

export const GIT_COMMIT_OUTCOMES = ["updated", "unavailable"] as const;

export type GitCommitOutcome = (typeof GIT_COMMIT_OUTCOMES)[number];

export type GitErrorKind = (typeof GIT_ERROR_KINDS)[number];

// Whether the status read right after a successful commit could be obtained. A failure
// there does not undo the commit, so it is part of the result, not an error
// (docs/git-development.md §11.11).
export type GitCommitStatus =
  | { readonly outcome: "updated"; readonly status: GitStatus }
  | { readonly outcome: "unavailable"; readonly errorKind: GitErrorKind };

export interface GitCommitResult {
  // Object ID of the new HEAD (40 or 64 lowercase hexadecimal characters); null only when
  // the commit was made but HEAD could not be read afterwards.
  readonly commitId: string | null;
  readonly status: GitCommitStatus;
}

// One commit of the history. Author data is untrusted repository text: show it as text only.
export interface GitHistoryEntry {
  // Full object IDs (40 or 64 lowercase hexadecimal characters).
  readonly commitId: string;
  readonly parentIds: readonly string[];
  readonly authorName: string;
  readonly authorEmail: string;
  // ISO 8601 with the author's UTC offset (or Z).
  readonly authorDate: string;
  // The first line of the message.
  readonly summary: string;
}

export interface GitHistoryPage {
  // Newest first.
  readonly entries: readonly GitHistoryEntry[];
  // Opaque; pass it back to read the next page. Null when there is no further page.
  readonly nextCursor: string | null;
}

export interface GitGateway {
  gitStatus(projectId: ProjectId): Promise<OperationResult<GitStatus>>;
  // Stages changed files (Project root relative, `/` separated) and returns the status
  // read afterwards. After a failure the index may be partly changed: read the status again.
  stage(
    projectId: ProjectId,
    paths: readonly string[],
  ): Promise<OperationResult<GitStatus>>;
  // Takes staged files back out of the index (a staged rename as a whole) and returns the
  // status read afterwards. Working tree files are never changed.
  unstage(
    projectId: ProjectId,
    paths: readonly string[],
  ): Promise<OperationResult<GitStatus>>;
  // Diff of one changed file on one side. Read-only.
  diff(
    projectId: ProjectId,
    path: string,
    side: GitDiffSide,
  ): Promise<OperationResult<GitDiff>>;
  // Commits the staged changes only. Rust validates the message (nothing is trimmed or
  // checked here). After a failure the index may have been changed by hooks: read the
  // status again.
  commit(
    projectId: ProjectId,
    message: string,
  ): Promise<OperationResult<GitCommitResult>>;
  // One page of the commit history, newest first, starting from the first page when
  // `cursor` is null. Read-only. Rust validates `limit` and the cursor.
  history(
    projectId: ProjectId,
    limit: number,
    cursor: string | null,
  ): Promise<OperationResult<GitHistoryPage>>;
}
