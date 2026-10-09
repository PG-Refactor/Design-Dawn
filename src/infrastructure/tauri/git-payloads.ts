// Strict decoder for the `git_status` payload: every field and every identifier is
// checked, so a payload from a newer or broken backend becomes `invalidCommandResponse`
// instead of reaching the application layer.

import {
  GIT_COMMIT_OUTCOMES,
  GIT_DIFF_OUTCOMES,
  GIT_DIFF_SIDES,
  GIT_FILE_CHANGES,
  GIT_REPOSITORY_STATES,
  type GitCommitOutcome,
  type GitCommitResult,
  type GitDiff,
  type GitDiffOutcome,
  type GitDiffSide,
  type GitErrorKind,
  type GitFileChange,
  type GitFileStatus,
  type GitHistoryEntry,
  type GitHistoryPage,
  type GitRepositoryState,
  type GitStatus,
} from "../../application/ports/git-gateway";
import { GIT_ERROR_KINDS } from "../../application/ports/operation-error";
import { type CommandResult, commandErr, commandOk } from "./command-error";
import {
  arrayOf,
  type Decoder,
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

interface RawGitCommitHead {
  readonly commitId: string | null;
  readonly status: { readonly outcome: GitCommitOutcome };
}

// A full object ID only: the UI may show it or hand it back to git, so anything else is a
// broken payload.
const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

const decodeObjectId: Decoder<string> = (value, path) => {
  const text = decodeString(value, path);
  if (!text.ok) return text;
  return OBJECT_ID_PATTERN.test(text.value)
    ? text
    : {
        ok: false,
        detail: `${path}: expected a lowercase hexadecimal object id`,
      };
};

const rawGitCommitHead = objectOf<RawGitCommitHead>({
  commitId: nullable(decodeObjectId),
  status: objectOf<{ readonly outcome: GitCommitOutcome }>({
    outcome: oneOf<readonly GitCommitOutcome[]>(GIT_COMMIT_OUTCOMES),
  }),
});

const rawUpdatedStatus = objectOf<{ readonly status: unknown }>({
  status: (value) => ({ ok: true, value }),
});

const rawUnavailableStatus = objectOf<{ readonly errorKind: GitErrorKind }>({
  errorKind: oneOf<readonly GitErrorKind[]>(GIT_ERROR_KINDS),
});

export function toGitCommitResult(
  payload: unknown,
): CommandResult<GitCommitResult> {
  const head = rawGitCommitHead(payload, PAYLOAD_ROOT);
  if (!head.ok) return commandErr("invalidCommandResponse", head.detail);
  const { commitId, status } = head.value;
  // `head` proved the payload is an object with an object `status`.
  const rawStatus = (payload as { readonly status: unknown }).status;
  if (status.outcome === "unavailable") {
    const body = rawUnavailableStatus(rawStatus, `${PAYLOAD_ROOT}.status`);
    return body.ok
      ? commandOk({
          commitId,
          status: { outcome: "unavailable", errorKind: body.value.errorKind },
        })
      : commandErr("invalidCommandResponse", body.detail);
  }
  const body = rawUpdatedStatus(rawStatus, `${PAYLOAD_ROOT}.status`);
  if (!body.ok) return commandErr("invalidCommandResponse", body.detail);
  const nested = toGitStatus(body.value.status);
  return nested.ok
    ? commandOk({
        commitId,
        status: { outcome: "updated", status: nested.value },
      })
    : commandErr(
        "invalidCommandResponse",
        `status.status: ${nested.error.detail}`,
      );
}

// ISO 8601 date and time with an offset or Z (git prints `+00:00` style offsets). Only the
// shape is checked; the UI formats the value.
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const decodeIsoDateTime: Decoder<string> = (value, path) => {
  const text = decodeString(value, path);
  if (!text.ok) return text;
  return ISO_DATE_TIME_PATTERN.test(text.value)
    ? text
    : { ok: false, detail: `${path}: expected an ISO 8601 date and time` };
};

const rawGitHistoryPage = objectOf<GitHistoryPage>({
  entries: arrayOf(
    objectOf<GitHistoryEntry>({
      commitId: decodeObjectId,
      parentIds: arrayOf(decodeObjectId),
      authorName: decodeString,
      authorEmail: decodeString,
      authorDate: decodeIsoDateTime,
      summary: decodeString,
    }),
  ),
  nextCursor: nullable(decodeString),
});

export function toGitHistoryPage(
  payload: unknown,
): CommandResult<GitHistoryPage> {
  const decoded = rawGitHistoryPage(payload, PAYLOAD_ROOT);
  return decoded.ok
    ? commandOk({
        entries: decoded.value.entries,
        nextCursor: decoded.value.nextCursor,
      })
    : commandErr("invalidCommandResponse", decoded.detail);
}
