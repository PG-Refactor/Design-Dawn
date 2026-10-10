// Typed wrapper for the Git Tauri command (docs/architecture.md §6.2). The Frontend passes
// only the Project ID; Rust finds the Repository from the Project's root.

import type {
  GitCommitOptions,
  GitCommitResult,
  GitDiff,
  GitDiffSide,
  GitDiscardImpact,
  GitHistoryPage,
  GitRemoteResult,
  GitStatus,
  GitUndoCommitResult,
} from "../../application/ports/git-gateway";
import type { ProjectId } from "../../domain/shared/entity-id";
import { COMMANDS } from "./command-constants";
import type { CommandResult } from "./command-error";
import {
  toGitCommitResult,
  toGitDiff,
  toGitDiscardImpact,
  toGitHistoryPage,
  toGitRemoteResult,
  toGitStatus,
  toGitUndoCommitResult,
  toRemoteNames,
} from "./git-payloads";
import { call } from "./invoke-command";

export function gitStatus(
  projectId: ProjectId,
): Promise<CommandResult<GitStatus>> {
  return call(COMMANDS.gitStatus, { projectId }, toGitStatus);
}

export function gitStage(
  projectId: ProjectId,
  paths: readonly string[],
): Promise<CommandResult<GitStatus>> {
  return call(COMMANDS.gitStage, { projectId, paths }, toGitStatus);
}

export function gitUnstage(
  projectId: ProjectId,
  paths: readonly string[],
): Promise<CommandResult<GitStatus>> {
  return call(COMMANDS.gitUnstage, { projectId, paths }, toGitStatus);
}

export function gitDiscard(
  projectId: ProjectId,
  paths: readonly string[],
): Promise<CommandResult<GitStatus>> {
  return call(COMMANDS.gitDiscard, { projectId, paths }, toGitStatus);
}

export function gitDiscardImpact(
  projectId: ProjectId,
  paths: readonly string[],
): Promise<CommandResult<GitDiscardImpact>> {
  return call(
    COMMANDS.gitDiscardImpact,
    { projectId, paths },
    toGitDiscardImpact,
  );
}

export function gitDiff(
  projectId: ProjectId,
  path: string,
  side: GitDiffSide,
): Promise<CommandResult<GitDiff>> {
  return call(COMMANDS.gitDiff, { projectId, path, side }, toGitDiff);
}

export function gitCommit(
  projectId: ProjectId,
  message: string,
  options: GitCommitOptions,
): Promise<CommandResult<GitCommitResult>> {
  return call(
    COMMANDS.gitCommit,
    {
      projectId,
      message,
      options: { amend: options.amend, stageAll: options.stageAll },
    },
    toGitCommitResult,
  );
}

export function gitUndoLastCommit(
  projectId: ProjectId,
): Promise<CommandResult<GitUndoCommitResult>> {
  return call(COMMANDS.gitUndoLastCommit, { projectId }, toGitUndoCommitResult);
}

export function gitHistory(
  projectId: ProjectId,
  limit: number,
  cursor: string | null,
): Promise<CommandResult<GitHistoryPage>> {
  return call(
    COMMANDS.gitHistory,
    { projectId, limit, cursor },
    toGitHistoryPage,
  );
}

export function gitFetch(
  projectId: ProjectId,
): Promise<CommandResult<GitRemoteResult>> {
  return call(COMMANDS.gitFetch, { projectId }, toGitRemoteResult);
}

export function gitPull(
  projectId: ProjectId,
): Promise<CommandResult<GitRemoteResult>> {
  return call(COMMANDS.gitPull, { projectId }, toGitRemoteResult);
}

export function gitPush(
  projectId: ProjectId,
): Promise<CommandResult<GitRemoteResult>> {
  return call(COMMANDS.gitPush, { projectId }, toGitRemoteResult);
}

export function gitPublish(
  projectId: ProjectId,
  remote: string,
): Promise<CommandResult<GitRemoteResult>> {
  return call(COMMANDS.gitPublish, { projectId, remote }, toGitRemoteResult);
}

export function gitRemotes(
  projectId: ProjectId,
): Promise<CommandResult<readonly string[]>> {
  return call(COMMANDS.gitRemotes, { projectId }, toRemoteNames);
}
