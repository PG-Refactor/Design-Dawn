// Typed wrapper for the Git Tauri command (docs/architecture.md §6.2). The Frontend passes
// only the Project ID; Rust finds the Repository from the Project's root.

import type {
  GitDiff,
  GitDiffSide,
  GitStatus,
} from "../../application/ports/git-gateway";
import type { ProjectId } from "../../domain/shared/entity-id";
import { COMMANDS } from "./command-constants";
import type { CommandResult } from "./command-error";
import { toGitDiff, toGitStatus } from "./git-payloads";
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

export function gitDiff(
  projectId: ProjectId,
  path: string,
  side: GitDiffSide,
): Promise<CommandResult<GitDiff>> {
  return call(COMMANDS.gitDiff, { projectId, path, side }, toGitDiff);
}
