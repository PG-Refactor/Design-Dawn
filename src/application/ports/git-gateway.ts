// Port for the Project's Git state (docs/git-development.md §11). Git is read through the
// Rust side only; the Frontend never sees a path of the machine, git's raw status codes
// or its stderr. The values below are the wire identifiers Rust sends.

import type { ProjectId } from "../../domain/shared/entity-id";
import type { OperationResult } from "./operation-error";

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

export interface GitStatus {
  readonly repositoryState: GitRepositoryState;
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
}
