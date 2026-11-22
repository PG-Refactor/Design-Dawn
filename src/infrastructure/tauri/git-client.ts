// Typed wrapper for the Git Tauri command. The Frontend passes
// only the Project ID; Rust finds the Repository from the Project's root.

import type {
  GitCommitOptions,
  GitCommitResult,
  GitConflictVersions,
  GitDiff,
  GitDiffSide,
  GitDiscardImpact,
  GitHistoryPage,
  GitRemoteResult,
  GitSheetVersion,
  GitSheetVersions,
  GitStatus,
  GitUndoCommitResult,
} from "../../application/ports/git-gateway";
import type { ProjectId } from "../../domain/shared/entity-id";
import { COMMANDS } from "./command-constants";
import { type CommandResult, commandErr, commandOk } from "./command-error";
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
import {
  arrayOf,
  decodeString,
  nullable,
  objectOf,
  recordOf,
} from "./payload-decoder";
import { parseSheetText } from "./persistence-payloads";

export function gitStatus(
  projectId: ProjectId,
): Promise<CommandResult<GitStatus>> {
  return call(COMMANDS.gitStatus, { projectId }, toGitStatus);
}

// Turns core.longpaths on in the Project's repository.
export function gitEnableLongPaths(
  projectId: ProjectId,
): Promise<CommandResult<void>> {
  return call(COMMANDS.enableGitLongPaths, { projectId }, () =>
    commandOk(undefined),
  );
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

export function gitAbortMerge(
  projectId: ProjectId,
): Promise<CommandResult<GitRemoteResult>> {
  return call(COMMANDS.gitAbortMerge, { projectId }, toGitRemoteResult);
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

const rawConflictVersions = objectOf<GitConflictVersions>({
  path: decodeString,
  base: nullable(decodeString),
  ours: nullable(decodeString),
  theirs: nullable(decodeString),
  current: nullable(decodeString),
  merged: nullable(decodeString),
  conflictingBlocks: arrayOf(decodeString),
});

interface RawSheetVersion extends Omit<GitSheetVersion, "sheet"> {
  readonly sheet: string;
}
interface RawSheetVersions {
  readonly documentId: string | null;
  readonly before: RawSheetVersion | null;
  readonly after: RawSheetVersion | null;
}
const rawSheetVersion = objectOf<RawSheetVersion>({
  sheet: decodeString,
  texts: recordOf(decodeString),
  images: recordOf(decodeString),
});
const rawSheetVersions = objectOf<RawSheetVersions>({
  documentId: nullable(decodeString),
  before: nullable(rawSheetVersion),
  after: nullable(rawSheetVersion),
});

function toSheetVersion(raw: RawSheetVersion | null): GitSheetVersion | null {
  return raw === null ? null : { ...raw, sheet: parseSheetText(raw.sheet) };
}

export function gitSheetVersions(
  projectId: ProjectId,
  path: string,
  side: GitDiffSide,
): Promise<CommandResult<GitSheetVersions>> {
  return call(
    COMMANDS.gitSheetVersions,
    { projectId, path, side },
    (payload) => {
      const decoded = rawSheetVersions(payload, "payload");
      return decoded.ok
        ? commandOk({
            documentId: decoded.value.documentId,
            before: toSheetVersion(decoded.value.before),
            after: toSheetVersion(decoded.value.after),
          })
        : commandErr("invalidCommandResponse", decoded.detail);
    },
  );
}

export function gitConflictVersions(
  projectId: ProjectId,
  path: string,
): Promise<CommandResult<GitConflictVersions>> {
  return call(COMMANDS.gitConflictVersions, { projectId, path }, (payload) => {
    const decoded = rawConflictVersions(payload, "payload");
    return decoded.ok
      ? commandOk(decoded.value)
      : commandErr("invalidCommandResponse", decoded.detail);
  });
}

export function gitResolveConflict(
  projectId: ProjectId,
  path: string,
  content: string,
): Promise<CommandResult<GitStatus>> {
  return call(
    COMMANDS.gitResolveConflict,
    { projectId, path, content },
    toGitStatus,
  );
}
