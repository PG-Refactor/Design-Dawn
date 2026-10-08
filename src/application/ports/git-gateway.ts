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
}
