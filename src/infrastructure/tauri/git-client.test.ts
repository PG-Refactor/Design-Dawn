import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_ID } from "../../domain/shared/test-fixtures";
import { COMMANDS } from "./command-constants";
import { gitStage, gitStatus, gitUnstage } from "./git-client";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

const VALID_PAYLOAD = {
  repository: { state: "ready" },
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
    invokeMock.mockResolvedValueOnce({ repository: { state }, files: [] });

    const result = await gitStatus(PROJECT_ID);

    expect(result).toStrictEqual({
      ok: true,
      value: { repositoryState: state, files: [] },
    });
  });

  it.each([
    ["a non-object", "ready"],
    ["a missing repository", { files: [] }],
    ["an unknown state", { repository: { state: "dirty" }, files: [] }],
    ["missing files", { repository: { state: "ready" } }],
    [
      "an unknown change",
      {
        repository: { state: "ready" },
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
        files: [
          { path: "a", indexStatus: "added", worktreeStatus: "modified" },
        ],
      },
    ],
    [
      "a non-string path",
      {
        repository: { state: "ready" },
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
      value: { repositoryState: "ready", files: VALID_PAYLOAD.files },
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
      value: { repositoryState: "ready", files: VALID_PAYLOAD.files },
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
