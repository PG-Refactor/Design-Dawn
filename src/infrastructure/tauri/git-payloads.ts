// Strict decoder for the `git_status` payload: every field and every identifier is
// checked, so a payload from a newer or broken backend becomes `invalidCommandResponse`
// instead of reaching the application layer.

import {
  GIT_FILE_CHANGES,
  GIT_REPOSITORY_STATES,
  type GitFileChange,
  type GitFileStatus,
  type GitRepositoryState,
  type GitStatus,
} from "../../application/ports/git-gateway";
import { type CommandResult, commandErr, commandOk } from "./command-error";
import {
  arrayOf,
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
