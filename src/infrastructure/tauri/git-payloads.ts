// Strict decoder for the `git_status` payload: every field and every identifier is
// checked, so a payload from a newer or broken backend becomes `invalidCommandResponse`
// instead of reaching the application layer.

import {
  GIT_DIFF_OUTCOMES,
  GIT_DIFF_SIDES,
  GIT_FILE_CHANGES,
  GIT_REPOSITORY_STATES,
  type GitDiff,
  type GitDiffOutcome,
  type GitDiffSide,
  type GitFileChange,
  type GitFileStatus,
  type GitRepositoryState,
  type GitStatus,
} from "../../application/ports/git-gateway";
import { type CommandResult, commandErr, commandOk } from "./command-error";
import {
  arrayOf,
  decodeNumber,
  decodeString,
  nullable,
  objectOf,
  oneOf,
} from "./payload-decoder";

const PAYLOAD_ROOT = "payload";

interface RawGitStatus {
  readonly repository: { readonly state: GitRepositoryState };
  readonly files: readonly GitFileStatus[];
}

const decodeFileChange = oneOf<readonly GitFileChange[]>(GIT_FILE_CHANGES);

const rawGitStatus = objectOf<RawGitStatus>({
  repository: objectOf<{ readonly state: GitRepositoryState }>({
    state: oneOf<readonly GitRepositoryState[]>(GIT_REPOSITORY_STATES),
  }),
  files: arrayOf(
    objectOf<GitFileStatus>({
      path: decodeString,
      indexStatus: decodeFileChange,
      worktreeStatus: decodeFileChange,
      originalPath: nullable(decodeString),
    }),
  ),
});

export function toGitStatus(payload: unknown): CommandResult<GitStatus> {
  const decoded = rawGitStatus(payload, PAYLOAD_ROOT);
  return decoded.ok
    ? commandOk({
        repositoryState: decoded.value.repository.state,
        files: decoded.value.files,
      })
    : commandErr("invalidCommandResponse", decoded.detail);
}

interface RawGitDiffHead {
  readonly path: string;
  readonly side: GitDiffSide;
  readonly outcome: GitDiffOutcome;
}

const rawGitDiffHead = objectOf<RawGitDiffHead>({
  path: decodeString,
  side: oneOf<readonly GitDiffSide[]>(GIT_DIFF_SIDES),
  outcome: oneOf<readonly GitDiffOutcome[]>(GIT_DIFF_OUTCOMES),
});

const rawTextDiff = objectOf<{ readonly diff: string }>({ diff: decodeString });
const rawTooLargeDiff = objectOf<{ readonly limitBytes: number }>({
  limitBytes: decodeNumber,
});

export function toGitDiff(payload: unknown): CommandResult<GitDiff> {
  const head = rawGitDiffHead(payload, PAYLOAD_ROOT);
  if (!head.ok) return commandErr("invalidCommandResponse", head.detail);
  const { path, side, outcome } = head.value;
  switch (outcome) {
    case "text": {
      const body = rawTextDiff(payload, PAYLOAD_ROOT);
      return body.ok
        ? commandOk({ path, side, outcome, diff: body.value.diff })
        : commandErr("invalidCommandResponse", body.detail);
    }
    case "tooLarge": {
      const body = rawTooLargeDiff(payload, PAYLOAD_ROOT);
      return body.ok
        ? commandOk({ path, side, outcome, limitBytes: body.value.limitBytes })
        : commandErr("invalidCommandResponse", body.detail);
    }
    case "empty":
    case "untracked":
    case "binary":
    case "notUtf8":
      return commandOk({ path, side, outcome });
  }
}
