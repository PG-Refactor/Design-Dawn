import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DOCUMENT_ID, PROJECT_ID } from "../../domain/shared/test-fixtures";
import { COMMANDS } from "./command-constants";
import {
  gitCommit,
  gitDiff,
  gitDiscard,
  gitDiscardImpact,
  gitFetch,
  gitHistory,
  gitPublish,
  gitPull,
  gitPush,
  gitRemotes,
  gitStage,
  gitStatus,
  gitUndoLastCommit,
  gitUnstage,
} from "./git-client";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

const VALID_PAYLOAD = {
  repository: { state: "ready" },
  branch: {
    head: "feature/設計",
    oid: "0123456789abcdef",
    upstream: "origin/feature/設計",
    ahead: 2,
    behind: 0,
    headPushed: false,
  },
  files: [
    {
      path: "documents/設計/sheet.json",
      indexStatus: "renamed",
      worktreeStatus: "modified",
      originalPath: "documents/old/sheet.json",
    },
    {
      path: "notes.md",
      indexStatus: "untracked",
      worktreeStatus: "untracked",
      originalPath: null,
    },
  ],
};

beforeEach(() => {
  invokeMock.mockReset();
});

describe("gitStatus", () => {
  it("sends only the project id and decodes the payload", async () => {
    invokeMock.mockResolvedValueOnce(VALID_PAYLOAD);

    const result = await gitStatus(PROJECT_ID);

    expect(invokeMock.mock.calls).toStrictEqual([
      [COMMANDS.gitStatus, { projectId: PROJECT_ID }],
    ]);
    expect(result).toStrictEqual({
      ok: true,
      value: {
        repositoryState: "ready",
        branch: VALID_PAYLOAD.branch,
        files: VALID_PAYLOAD.files,
      },
    });
  });

  it.each([
    "ready",
    "notRepository",
    "unsupportedRepositoryLayout",
    "gitUnavailable",
    "error",
  ])("accepts the %s state with no files", async (state) => {
    invokeMock.mockResolvedValueOnce({
      repository: { state },
      branch: null,
      files: [],
    });

    const result = await gitStatus(PROJECT_ID);

    expect(result).toStrictEqual({
      ok: true,
      value: { repositoryState: state, branch: null, files: [] },
    });
  });

  it.each([
    ["a non-object", "ready"],
    ["a missing repository", { branch: null, files: [] }],
    [
      "an unknown state",
      { repository: { state: "dirty" }, branch: null, files: [] },
    ],
    ["missing files", { repository: { state: "ready" }, branch: null }],
    ["a missing branch", { repository: { state: "ready" }, files: [] }],
    [
      "a non-string branch head",
      {
        repository: { state: "ready" },
        branch: { ...VALID_PAYLOAD.branch, head: 1 },
        files: [],
      },
    ],
    [
      "a branch without oid",
      { repository: { state: "ready" }, branch: { head: "main" }, files: [] },
    ],
    [
      "an unknown change",
      {
        repository: { state: "ready" },
        branch: null,
        files: [
          {
            path: "a",
            indexStatus: "staged",
            worktreeStatus: "modified",
            originalPath: null,
          },
        ],
      },
    ],
    [
      "a missing originalPath",
      {
        repository: { state: "ready" },
        branch: null,
        files: [
          { path: "a", indexStatus: "added", worktreeStatus: "modified" },
        ],
      },
    ],
    [
      "a non-string path",
      {
        repository: { state: "ready" },
        branch: null,
        files: [
          {
            path: 1,
            indexStatus: "added",
            worktreeStatus: "modified",
            originalPath: null,
          },
        ],
      },
    ],
  ])("rejects %s as invalidCommandResponse", async (_name, payload) => {
    invokeMock.mockResolvedValueOnce(payload);

    const result = await gitStatus(PROJECT_ID);

    expect(!result.ok && result.error.kind).toBe("invalidCommandResponse");
  });

  it.each([
    "gitCommandFailed",
    "gitTimeout",
    "invalidGitPath",
    "gitNotReady",
    "projectNotOpen",
  ])("keeps the %s error kind", async (kind) => {
    invokeMock.mockRejectedValueOnce({ kind, detail: "d" });

    const result = await gitStatus(PROJECT_ID);

    expect(result).toStrictEqual({ ok: false, error: { kind, detail: "d" } });
  });
});

describe("gitStage", () => {
  it("sends the project id and the paths and decodes the status", async () => {
    invokeMock.mockResolvedValueOnce(VALID_PAYLOAD);

    const result = await gitStage(PROJECT_ID, ["notes.md", "設計 書.md"]);

    expect(invokeMock.mock.calls).toStrictEqual([
      [
        COMMANDS.gitStage,
        { projectId: PROJECT_ID, paths: ["notes.md", "設計 書.md"] },
      ],
    ]);
    expect(result).toStrictEqual({
      ok: true,
      value: {
        repositoryState: "ready",
        branch: VALID_PAYLOAD.branch,
        files: VALID_PAYLOAD.files,
      },
    });
  });

  it("rejects a malformed payload as invalidCommandResponse", async () => {
    invokeMock.mockResolvedValueOnce({ repository: { state: "ready" } });

    const result = await gitStage(PROJECT_ID, ["a.md"]);

    expect(!result.ok && result.error.kind).toBe("invalidCommandResponse");
  });

  it.each(["gitNotReady", "invalidGitPath", "gitCommandFailed", "gitTimeout"])(
    "keeps the %s error kind",
    async (kind) => {
      invokeMock.mockRejectedValueOnce({ kind, detail: "d" });

      const result = await gitStage(PROJECT_ID, ["a.md"]);

      expect(result).toStrictEqual({ ok: false, error: { kind, detail: "d" } });
    },
  );
});

describe("gitDiscard", () => {
  it("sends the project id and the paths and decodes the status", async () => {
    invokeMock.mockResolvedValueOnce(VALID_PAYLOAD);

    const result = await gitDiscard(PROJECT_ID, ["notes.md", "設計 書.md"]);

    expect(invokeMock.mock.calls).toStrictEqual([
      [
        COMMANDS.gitDiscard,
        { projectId: PROJECT_ID, paths: ["notes.md", "設計 書.md"] },
      ],
    ]);
    expect(result).toStrictEqual({
      ok: true,
      value: {
        repositoryState: "ready",
        branch: VALID_PAYLOAD.branch,
        files: VALID_PAYLOAD.files,
      },
    });
  });

  it("rejects a malformed payload as invalidCommandResponse", async () => {
    invokeMock.mockResolvedValueOnce({ repository: { state: "ready" } });

    const result = await gitDiscard(PROJECT_ID, ["a.md"]);

    expect(!result.ok && result.error.kind).toBe("invalidCommandResponse");
  });

  it.each([
    "gitDiscardRejected",
    "gitNotReady",
    "invalidGitPath",
    "gitCommandFailed",
    "gitTimeout",
    "ioError",
  ])("keeps the %s error kind", async (kind) => {
    invokeMock.mockRejectedValueOnce({ kind, detail: "d" });

    const result = await gitDiscard(PROJECT_ID, ["a.md"]);

    expect(result).toStrictEqual({ ok: false, error: { kind, detail: "d" } });
  });
});

describe("gitDiscardImpact", () => {
  it("sends the project id and the paths and decodes the impact", async () => {
    invokeMock.mockResolvedValueOnce({
      documentIds: [DOCUMENT_ID],
      projectFilesAffected: true,
    });

    const result = await gitDiscardImpact(PROJECT_ID, ["project.json"]);

    expect(invokeMock.mock.calls).toStrictEqual([
      [
        COMMANDS.gitDiscardImpact,
        { projectId: PROJECT_ID, paths: ["project.json"] },
      ],
    ]);
    expect(result).toStrictEqual({
      ok: true,
      value: { documentIds: [DOCUMENT_ID], projectFilesAffected: true },
    });
  });

  it.each([
    ["a missing field", { documentIds: [] }],
    ["a non-boolean flag", { documentIds: [], projectFilesAffected: "yes" }],
    ["a non-array id list", { documentIds: "x", projectFilesAffected: false }],
    ["a non-string id", { documentIds: [1], projectFilesAffected: false }],
    [
      "an id that is not a canonical id",
      { documentIds: ["not-an-id"], projectFilesAffected: false },
    ],
    ["null", null],
  ])("rejects %s as invalidCommandResponse", async (_name, payload) => {
    invokeMock.mockResolvedValueOnce(payload);

    const result = await gitDiscardImpact(PROJECT_ID, ["a.md"]);

    expect(!result.ok && result.error.kind).toBe("invalidCommandResponse");
  });

  it("keeps the error kinds", async () => {
    invokeMock.mockRejectedValueOnce({ kind: "invalidGitPath", detail: "d" });

    const result = await gitDiscardImpact(PROJECT_ID, ["../a"]);

    expect(result).toStrictEqual({
      ok: false,
      error: { kind: "invalidGitPath", detail: "d" },
    });
  });
});

describe("gitUnstage", () => {
  it("sends the project id and the paths and decodes the status", async () => {
    invokeMock.mockResolvedValueOnce(VALID_PAYLOAD);

    const result = await gitUnstage(PROJECT_ID, ["notes.md", "設計 書.md"]);

    expect(invokeMock.mock.calls).toStrictEqual([
      [
        COMMANDS.gitUnstage,
        { projectId: PROJECT_ID, paths: ["notes.md", "設計 書.md"] },
      ],
    ]);
    expect(result).toStrictEqual({
      ok: true,
      value: {
        repositoryState: "ready",
        branch: VALID_PAYLOAD.branch,
        files: VALID_PAYLOAD.files,
      },
    });
  });

  it("rejects a malformed payload as invalidCommandResponse", async () => {
    invokeMock.mockResolvedValueOnce({ repository: { state: "ready" } });

    const result = await gitUnstage(PROJECT_ID, ["a.md"]);

    expect(!result.ok && result.error.kind).toBe("invalidCommandResponse");
  });

  it.each(["gitNotReady", "invalidGitPath", "gitCommandFailed", "gitTimeout"])(
    "keeps the %s error kind",
    async (kind) => {
      invokeMock.mockRejectedValueOnce({ kind, detail: "d" });

      const result = await gitUnstage(PROJECT_ID, ["a.md"]);

      expect(result).toStrictEqual({ ok: false, error: { kind, detail: "d" } });
    },
  );
});

describe("gitDiff", () => {
  const BASE = { path: "documents/a.md", side: "staged" };

  it("sends the project id, path and side", async () => {
    invokeMock.mockResolvedValueOnce({ ...BASE, outcome: "empty" });

    await gitDiff(PROJECT_ID, "documents/a.md", "staged");

    expect(invokeMock.mock.calls).toStrictEqual([
      [
        COMMANDS.gitDiff,
        { projectId: PROJECT_ID, path: "documents/a.md", side: "staged" },
      ],
    ]);
  });

  it.each([
    ["text", { diff: "@@ -1 +1 @@" }],
    ["empty", {}],
    ["binary", {}],
    ["tooLarge", { limitBytes: 1048576 }],
    ["notUtf8", {}],
  ])("decodes the %s outcome", async (outcome, extra) => {
    invokeMock.mockResolvedValueOnce({ ...BASE, outcome, ...extra });

    const result = await gitDiff(PROJECT_ID, BASE.path, "staged");

    expect(result).toStrictEqual({
      ok: true,
      value: { ...BASE, outcome, ...extra },
    });
  });

  it.each(["unstaged", "staged"])("decodes the %s side", async (side) => {
    invokeMock.mockResolvedValueOnce({ path: "a", side, outcome: "binary" });

    const result = await gitDiff(PROJECT_ID, "a", "unstaged");

    expect(result).toStrictEqual({
      ok: true,
      value: { path: "a", side, outcome: "binary" },
    });
  });

  it.each([
    ["a non-object", "text"],
    ["an unknown outcome", { ...BASE, outcome: "huge" }],
    ["a missing outcome", BASE],
    ["an unknown side", { ...BASE, side: "both", outcome: "empty" }],
    ["a missing path", { side: "staged", outcome: "empty" }],
    ["text without a diff", { ...BASE, outcome: "text" }],
    ["text with a non-string diff", { ...BASE, outcome: "text", diff: 1 }],
    ["tooLarge without a limit", { ...BASE, outcome: "tooLarge" }],
    [
      "tooLarge with a non-number limit",
      { ...BASE, outcome: "tooLarge", limitBytes: "1" },
    ],
  ])("rejects %s as invalidCommandResponse", async (_label, payload) => {
    invokeMock.mockResolvedValueOnce(payload);

    const result = await gitDiff(PROJECT_ID, BASE.path, "staged");

    expect(result).toMatchObject({
      ok: false,
      error: { kind: "invalidCommandResponse" },
    });
  });
});

describe("gitCommit", () => {
  const COMMIT_ID = "0123456789abcdef0123456789abcdef01234567";
  const SHA256_COMMIT_ID = `${COMMIT_ID}0123456789abcdef01234567`;
  const NO_OPTIONS = { amend: false, stageAll: false };

  const UPDATED = {
    commitId: COMMIT_ID,
    status: { outcome: "updated", status: VALID_PAYLOAD },
  };

  it("sends the project id and message and decodes an updated result", async () => {
    invokeMock.mockResolvedValueOnce(UPDATED);

    const result = await gitCommit(PROJECT_ID, "メッセージ", {
      amend: true,
      stageAll: false,
    });

    expect(invokeMock.mock.calls).toStrictEqual([
      [
        COMMANDS.gitCommit,
        {
          projectId: PROJECT_ID,
          message: "メッセージ",
          options: { amend: true, stageAll: false },
        },
      ],
    ]);
    expect(result).toStrictEqual({
      ok: true,
      value: {
        commitId: COMMIT_ID,
        status: {
          outcome: "updated",
          status: {
            repositoryState: "ready",
            branch: VALID_PAYLOAD.branch,
            files: VALID_PAYLOAD.files,
          },
        },
      },
    });
  });

  it("accepts a 64 character id and a null id", async () => {
    invokeMock.mockResolvedValueOnce({
      ...UPDATED,
      commitId: SHA256_COMMIT_ID,
    });
    invokeMock.mockResolvedValueOnce({ ...UPDATED, commitId: null });

    const long = await gitCommit(PROJECT_ID, "m", NO_OPTIONS);
    const none = await gitCommit(PROJECT_ID, "m", NO_OPTIONS);

    expect(long.ok && long.value.commitId).toBe(SHA256_COMMIT_ID);
    expect(none.ok && none.value.commitId).toBeNull();
  });

  it("decodes an unavailable status", async () => {
    invokeMock.mockResolvedValueOnce({
      commitId: COMMIT_ID,
      status: { outcome: "unavailable", errorKind: "gitTimeout" },
    });

    const result = await gitCommit(PROJECT_ID, "m", NO_OPTIONS);

    expect(result).toStrictEqual({
      ok: true,
      value: {
        commitId: COMMIT_ID,
        status: { outcome: "unavailable", errorKind: "gitTimeout" },
      },
    });
  });

  it.each([
    ["a missing commit id", { status: UPDATED.status }],
    ["an upper case id", { ...UPDATED, commitId: COMMIT_ID.toUpperCase() }],
    ["a short id", { ...UPDATED, commitId: "abc123" }],
    ["a non hexadecimal id", { ...UPDATED, commitId: "g".repeat(40) }],
    ["a number as id", { ...UPDATED, commitId: 1 }],
    ["a missing status", { commitId: COMMIT_ID }],
    [
      "an unknown outcome",
      { commitId: COMMIT_ID, status: { outcome: "later" } },
    ],
    [
      "an updated outcome without a status",
      {
        commitId: COMMIT_ID,
        status: { outcome: "updated" },
      },
    ],
    [
      "an updated outcome with a malformed status",
      {
        commitId: COMMIT_ID,
        status: { outcome: "updated", status: { repository: {}, files: [] } },
      },
    ],
    [
      "an unavailable outcome with an unknown error kind",
      {
        commitId: COMMIT_ID,
        status: { outcome: "unavailable", errorKind: "somethingElse" },
      },
    ],
    [
      "an unavailable outcome without an error kind",
      { commitId: COMMIT_ID, status: { outcome: "unavailable" } },
    ],
    ["a non object payload", "ok"],
  ])("rejects %s", async (_name, payload) => {
    invokeMock.mockResolvedValueOnce(payload);

    const result = await gitCommit(PROJECT_ID, "m", NO_OPTIONS);

    expect(!result.ok && result.error.kind).toBe("invalidCommandResponse");
  });

  it("passes a structured Rust error through", async () => {
    invokeMock.mockRejectedValueOnce({
      kind: "nothingToCommit",
      detail: "nothing staged",
    });

    const result = await gitCommit(PROJECT_ID, "m", NO_OPTIONS);

    expect(!result.ok && result.error.kind).toBe("nothingToCommit");
  });
});

describe("branch information", () => {
  function statusWithBranch(branch: unknown) {
    return { repository: { state: "ready" }, branch, files: [] };
  }

  it("decodes a branch without an upstream", async () => {
    const branch = {
      head: "main",
      oid: null,
      upstream: null,
      ahead: null,
      behind: null,
      headPushed: false,
    };
    invokeMock.mockResolvedValueOnce(statusWithBranch(branch));

    const result = await gitStatus(PROJECT_ID);

    expect(result.ok && result.value.branch).toStrictEqual(branch);
  });

  it.each([
    ["a missing upstream", { upstream: undefined }],
    ["a missing headPushed", { headPushed: undefined }],
    ["a non-boolean headPushed", { headPushed: "yes" }],
    ["a negative ahead", { ahead: -1 }],
    ["a fractional behind", { behind: 1.5 }],
    ["a string ahead", { ahead: "2" }],
    ["a numeric upstream", { upstream: 1 }],
  ])("rejects %s", async (_name, change) => {
    invokeMock.mockResolvedValueOnce(
      statusWithBranch({ ...VALID_PAYLOAD.branch, ...change }),
    );

    const result = await gitStatus(PROJECT_ID);

    expect(!result.ok && result.error.kind).toBe("invalidCommandResponse");
  });
});

describe("gitUndoLastCommit", () => {
  const UPDATED = {
    message: "元のメッセージ\n",
    status: { outcome: "updated", status: VALID_PAYLOAD },
  };

  it("sends only the project id and decodes the message and status", async () => {
    invokeMock.mockResolvedValueOnce(UPDATED);

    const result = await gitUndoLastCommit(PROJECT_ID);

    expect(invokeMock.mock.calls).toStrictEqual([
      [COMMANDS.gitUndoLastCommit, { projectId: PROJECT_ID }],
    ]);
    expect(result).toStrictEqual({
      ok: true,
      value: {
        message: "元のメッセージ\n",
        status: {
          outcome: "updated",
          status: {
            repositoryState: "ready",
            branch: VALID_PAYLOAD.branch,
            files: VALID_PAYLOAD.files,
          },
        },
      },
    });
  });

  it("accepts a null message and an unavailable status", async () => {
    invokeMock.mockResolvedValueOnce({
      message: null,
      status: { outcome: "unavailable", errorKind: "gitTimeout" },
    });

    const result = await gitUndoLastCommit(PROJECT_ID);

    expect(result).toStrictEqual({
      ok: true,
      value: {
        message: null,
        status: { outcome: "unavailable", errorKind: "gitTimeout" },
      },
    });
  });

  it.each([
    ["a missing message", { status: UPDATED.status }],
    ["a numeric message", { ...UPDATED, message: 1 }],
    ["a missing status", { message: "m" }],
    ["an unknown outcome", { message: "m", status: { outcome: "later" } }],
    [
      "an updated outcome without a status",
      { message: "m", status: { outcome: "updated" } },
    ],
    ["a non object payload", "ok"],
  ])("rejects %s", async (_name, payload) => {
    invokeMock.mockResolvedValueOnce(payload);

    const result = await gitUndoLastCommit(PROJECT_ID);

    expect(!result.ok && result.error.kind).toBe("invalidCommandResponse");
  });

  it.each([
    "gitCannotUndoCommit",
    "gitCommitAlreadyPushed",
    "gitOperationInProgress",
    "gitNotReady",
  ])("keeps the %s error kind", async (kind) => {
    invokeMock.mockRejectedValueOnce({ kind, detail: "d" });

    const result = await gitUndoLastCommit(PROJECT_ID);

    expect(result).toStrictEqual({ ok: false, error: { kind, detail: "d" } });
  });
});

describe("commit option error kinds", () => {
  it.each(["gitNoCommitToAmend", "gitCommitAlreadyPushed"])(
    "keeps the %s error kind",
    async (kind) => {
      invokeMock.mockRejectedValueOnce({ kind, detail: "d" });

      const result = await gitCommit(PROJECT_ID, "m", {
        amend: true,
        stageAll: false,
      });

      expect(result).toStrictEqual({ ok: false, error: { kind, detail: "d" } });
    },
  );
});

describe("gitHistory", () => {
  const ID_A = "0123456789abcdef0123456789abcdef01234567";
  const ID_B = `${ID_A}0123456789abcdef01234567`;
  const ENTRY = {
    commitId: ID_A,
    parentIds: [ID_B],
    authorName: "名前",
    authorEmail: "a@example.invalid",
    authorDate: "2026-01-02T03:04:05+09:00",
    summary: "件名",
  };
  const PAGE = { entries: [ENTRY], nextCursor: `${ID_A}:1` };

  it("sends the project id, limit and cursor and decodes a page", async () => {
    invokeMock.mockResolvedValueOnce(PAGE);

    const result = await gitHistory(PROJECT_ID, 50, null);

    expect(invokeMock.mock.calls).toStrictEqual([
      [COMMANDS.gitHistory, { projectId: PROJECT_ID, limit: 50, cursor: null }],
    ]);
    expect(result).toStrictEqual({ ok: true, value: PAGE });
  });

  it("passes the cursor on", async () => {
    invokeMock.mockResolvedValueOnce(PAGE);

    await gitHistory(PROJECT_ID, 10, "abc:1");

    expect(invokeMock.mock.calls[0]?.[1]).toStrictEqual({
      projectId: PROJECT_ID,
      limit: 10,
      cursor: "abc:1",
    });
  });

  it("decodes an empty page, a null cursor, a root commit and Z dates", async () => {
    invokeMock.mockResolvedValueOnce({ entries: [], nextCursor: null });
    invokeMock.mockResolvedValueOnce({
      entries: [
        { ...ENTRY, parentIds: [], authorDate: "2026-01-02T03:04:05Z" },
        { ...ENTRY, authorDate: "2026-01-02T03:04:05.123-05:00" },
      ],
      nextCursor: null,
    });

    const empty = await gitHistory(PROJECT_ID, 10, null);
    const full = await gitHistory(PROJECT_ID, 10, null);

    expect(empty).toStrictEqual({
      ok: true,
      value: { entries: [], nextCursor: null },
    });
    expect(full.ok && full.value.entries).toHaveLength(2);
    expect(full.ok && full.value.entries[0]?.parentIds).toEqual([]);
  });

  it.each([
    ["a non object payload", "ok"],
    ["a missing entries list", { nextCursor: null }],
    ["a missing next cursor", { entries: [] }],
    ["a numeric next cursor", { entries: [], nextCursor: 1 }],
    ["entries that are not a list", { entries: {}, nextCursor: null }],
    ["a short commit id", page({ commitId: "abc" })],
    ["an upper case commit id", page({ commitId: ID_A.toUpperCase() })],
    ["a non hexadecimal commit id", page({ commitId: "g".repeat(40) })],
    ["a numeric commit id", page({ commitId: 1 })],
    ["a missing commit id", page({ commitId: undefined })],
    ["parent ids that are not a list", page({ parentIds: ID_A })],
    ["a malformed parent id", page({ parentIds: ["xyz"] })],
    ["a date without time", page({ authorDate: "2026-01-02" })],
    ["a date without an offset", page({ authorDate: "2026-01-02T03:04:05" })],
    ["a git raw date", page({ authorDate: "2026-01-02 03:04:05 +0900" })],
    ["a numeric date", page({ authorDate: 1767323045 })],
    ["a numeric author name", page({ authorName: 1 })],
    ["a missing author email", page({ authorEmail: undefined })],
    ["a null summary", page({ summary: null })],
  ])("rejects %s", async (_name, payload) => {
    invokeMock.mockResolvedValueOnce(payload);

    const result = await gitHistory(PROJECT_ID, 10, null);

    expect(!result.ok && result.error.kind).toBe("invalidCommandResponse");
  });

  function page(override: Record<string, unknown>) {
    return { entries: [{ ...ENTRY, ...override }], nextCursor: null };
  }

  it("passes a structured Rust error through", async () => {
    invokeMock.mockRejectedValueOnce({
      kind: "invalidHistoryRequest",
      detail: "bad cursor",
    });

    const result = await gitHistory(PROJECT_ID, 10, "bad");

    expect(!result.ok && result.error.kind).toBe("invalidHistoryRequest");
  });
});

describe("remote operations", () => {
  const UPDATED = { status: { outcome: "updated", status: VALID_PAYLOAD } };
  const REMOTE_ERROR_KINDS = [
    "gitNoRemote",
    "gitNoUpstream",
    "gitDetachedHead",
    "gitRemoteNotFound",
    "gitAuthenticationFailed",
    "gitNetworkUnavailable",
    "gitPushRejected",
    "gitPullConflicts",
    "gitPullBlockedByLocalChanges",
    "gitTimeout",
  ];
  const OPERATIONS = [
    ["gitFetch", COMMANDS.gitFetch, () => gitFetch(PROJECT_ID), {}],
    ["gitPull", COMMANDS.gitPull, () => gitPull(PROJECT_ID), {}],
    ["gitPush", COMMANDS.gitPush, () => gitPush(PROJECT_ID), {}],
    [
      "gitPublish",
      COMMANDS.gitPublish,
      () => gitPublish(PROJECT_ID, "origin"),
      { remote: "origin" },
    ],
  ] as const;

  it.each(OPERATIONS)(
    "%s sends the project id (and the remote name) and decodes the status",
    async (_name, command, run, extra) => {
      invokeMock.mockResolvedValueOnce(UPDATED);

      const result = await run();

      expect(invokeMock.mock.calls).toStrictEqual([
        [command, { projectId: PROJECT_ID, ...extra }],
      ]);
      expect(result).toStrictEqual({
        ok: true,
        value: {
          status: {
            outcome: "updated",
            status: {
              repositoryState: "ready",
              branch: VALID_PAYLOAD.branch,
              files: VALID_PAYLOAD.files,
            },
          },
        },
      });
    },
  );

  it.each(OPERATIONS)(
    "%s accepts an unavailable status",
    async (_name, _command, run) => {
      invokeMock.mockResolvedValueOnce({
        status: { outcome: "unavailable", errorKind: "gitTimeout" },
      });

      const result = await run();

      expect(result).toStrictEqual({
        ok: true,
        value: { status: { outcome: "unavailable", errorKind: "gitTimeout" } },
      });
    },
  );

  it.each(OPERATIONS)(
    "%s rejects a malformed payload",
    async (_name, _command, run) => {
      for (const payload of [
        {},
        "ok",
        { status: { outcome: "later" } },
        { status: { outcome: "updated" } },
        { status: { outcome: "updated", status: { repository: {} } } },
        { status: { outcome: "unavailable" } },
        { status: { outcome: "unavailable", errorKind: "unknownKind" } },
      ]) {
        invokeMock.mockResolvedValueOnce(payload);

        const result = await run();

        expect(!result.ok && result.error.kind).toBe("invalidCommandResponse");
      }
    },
  );

  it.each(OPERATIONS)(
    "%s keeps every Rust error kind",
    async (_name, _command, run) => {
      for (const kind of REMOTE_ERROR_KINDS) {
        invokeMock.mockRejectedValueOnce({ kind, detail: "d" });

        const result = await run();

        expect(result).toStrictEqual({
          ok: false,
          error: { kind, detail: "d" },
        });
      }
    },
  );

  it("accepts every remote error kind inside an unavailable status", async () => {
    for (const errorKind of REMOTE_ERROR_KINDS) {
      invokeMock.mockResolvedValueOnce({
        status: { outcome: "unavailable", errorKind },
      });

      const result = await gitFetch(PROJECT_ID);

      expect(result.ok).toBe(true);
    }
  });
});

describe("gitRemotes", () => {
  it("sends only the project id and decodes the names", async () => {
    invokeMock.mockResolvedValueOnce(["origin", "バックアップ"]);

    const result = await gitRemotes(PROJECT_ID);

    expect(invokeMock.mock.calls).toStrictEqual([
      [COMMANDS.gitRemotes, { projectId: PROJECT_ID }],
    ]);
    expect(result).toStrictEqual({
      ok: true,
      value: ["origin", "バックアップ"],
    });
  });

  it("accepts an empty list", async () => {
    invokeMock.mockResolvedValueOnce([]);

    expect(await gitRemotes(PROJECT_ID)).toStrictEqual({ ok: true, value: [] });
  });

  it.each([
    ["a non array", "origin"],
    ["a null payload", null],
    ["a numeric name", ["origin", 1]],
    ["an object name", [{ name: "origin" }]],
  ])("rejects %s", async (_name, payload) => {
    invokeMock.mockResolvedValueOnce(payload);

    const result = await gitRemotes(PROJECT_ID);

    expect(!result.ok && result.error.kind).toBe("invalidCommandResponse");
  });

  it("keeps the Rust error kind", async () => {
    invokeMock.mockRejectedValueOnce({ kind: "gitNotReady", detail: "d" });

    expect(await gitRemotes(PROJECT_ID)).toStrictEqual({
      ok: false,
      error: { kind: "gitNotReady", detail: "d" },
    });
  });
});
