import { describe, expect, it } from "vitest";
import { renameSheetCommand } from "../../application/commands/naming-commands";
import { operationErr } from "../../application/ports/operation-error";
import { displayName, settle } from "../../application/test-support/fakes";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  SHEET_A1,
  SHEET_B1,
} from "../../application/test-support/workspace-harness";
import {
  type ActionsHarness,
  makeDocumentADirty,
  openedActionsHarness,
} from "../workspace/test-support/actions-harness";
import type { DiscardTarget } from "../workspace/ui-state/ui-state";
import { openDiffPinned } from "./git-diff-session";
import { confirmGitDiscard, requestGitDiscard } from "./git-discard-flow";

const TRACKED: DiscardTarget = {
  path: "documents/a/document.json",
  untracked: false,
};
const NOTES: DiscardTarget = { path: "notes.md", untracked: true };
const WRITE_METHODS = ["saveProject", "saveDocument", "saveSheet"] as const;

async function openedWithDocuments(): Promise<ActionsHarness> {
  const harness = await openedActionsHarness();
  await harness.actions.openDocument(DOCUMENT_A);
  await harness.actions.openDocument(DOCUMENT_B);
  await harness.actions.openDocument(DOCUMENT_A);
  return harness;
}

function openIds(harness: ActionsHarness) {
  return [...harness.store.getState().documents.keys()];
}

async function ask(
  harness: ActionsHarness,
  targets: readonly DiscardTarget[],
  impact: {
    documentIds: readonly (typeof DOCUMENT_A)[];
    projectFilesAffected: boolean;
  },
): Promise<void> {
  harness.gitGateway.impactResult = {
    documentIds: [...impact.documentIds],
    projectFilesAffected: impact.projectFilesAffected,
  };
  await requestGitDiscard(harness.services, targets);
}

const dialogOf = (harness: ActionsHarness) =>
  harness.uiStateStore.getState().dialog;

const discardErrors = (harness: ActionsHarness) =>
  harness.uiStateStore
    .getState()
    .operationErrors.filter((entry) => entry.operation === "discardGitChanges");

async function dirtyDocumentB(harness: ActionsHarness): Promise<void> {
  const result = await harness.workspace
    .getDocumentSession(DOCUMENT_B)
    ?.execute(renameSheetCommand(SHEET_B1, displayName("Edited B")));
  expect(result?.ok).toBe(true);
}

describe("asking", () => {
  it("reads the impact once and opens the question with it", async () => {
    const harness = await openedWithDocuments();
    await ask(harness, [TRACKED, NOTES], {
      documentIds: [DOCUMENT_A],
      projectFilesAffected: true,
    });
    expect(harness.gitGateway.discardImpactCalls.map((c) => c.paths)).toEqual([
      [TRACKED.path, NOTES.path],
    ]);
    expect(dialogOf(harness)).toEqual({
      kind: "confirmDiscardGitChanges",
      targets: [TRACKED, NOTES],
      documentIds: [DOCUMENT_A],
      projectFilesAffected: true,
    });
    expect(harness.gitGateway.discardCalls).toEqual([]);
  });

  it("reports a failed impact read once and asks nothing", async () => {
    const harness = await openedWithDocuments();
    harness.gitGateway.failure = { kind: "ioError", detail: "boom" };
    await requestGitDiscard(harness.services, [TRACKED]);
    expect(dialogOf(harness).kind).toBe("none");
    expect(discardErrors(harness)).toHaveLength(1);
    expect(harness.gitGateway.discardCalls).toEqual([]);
  });

  it("opens one question for two quick requests", async () => {
    const harness = await openedWithDocuments();
    harness.gitGateway.impactResult = {
      documentIds: [],
      projectFilesAffected: false,
    };
    await Promise.all([
      requestGitDiscard(harness.services, [TRACKED]),
      requestGitDiscard(harness.services, [TRACKED]),
    ]);
    expect(harness.gitGateway.discardImpactCalls).toHaveLength(1);
  });

  it("changes nothing when the question is cancelled", async () => {
    const harness = await openedWithDocuments();
    await ask(harness, [TRACKED], {
      documentIds: [DOCUMENT_A],
      projectFilesAffected: false,
    });
    harness.gateway.clearCalls();
    harness.actions.cancelDialog();
    expect(dialogOf(harness).kind).toBe("none");
    expect(harness.gitGateway.discardCalls).toEqual([]);
    expect(harness.gateway.calls).toEqual([]);
    expect(openIds(harness)).toEqual([DOCUMENT_A, DOCUMENT_B]);
  });
});

describe("confirming without project files", () => {
  it("closes the affected Document unsaved, discards, then reads it again", async () => {
    const harness = await openedWithDocuments();
    await makeDocumentADirty(harness);
    expect(
      harness.store.getState().documents.get(DOCUMENT_A)?.history.canUndo,
    ).toBe(true);
    await ask(harness, [TRACKED], {
      documentIds: [DOCUMENT_A],
      projectFilesAffected: false,
    });
    harness.gateway.clearCalls();
    const release = harness.gitGateway.holdNextDiscard();

    const confirmed = confirmGitDiscard(harness.services);
    await settle();
    // While git works: the Document is closed (nothing written) and not yet read again.
    expect(harness.gitGateway.discardCalls).toHaveLength(1);
    expect(harness.gateway.methods("closeDocument")).toEqual(["closeDocument"]);
    expect(harness.gateway.methods(...WRITE_METHODS)).toEqual([]);
    expect(harness.gateway.methods("loadDocument")).toEqual([]);
    expect(harness.uiStateStore.getState().busy).toBe(true);

    release();
    await confirmed;
    expect(harness.gitGateway.discardCalls[0]?.paths).toEqual([TRACKED.path]);
    expect(harness.gateway.methods("loadDocument")).toEqual(["loadDocument"]);
    expect(harness.gateway.methods(...WRITE_METHODS)).toEqual([]);
    const reopened = harness.store.getState().documents.get(DOCUMENT_A);
    expect(reopened?.history.canUndo).toBe(false);
    expect(reopened?.sheets.get(SHEET_A1)?.name).toBe("Sheet A1");
    expect(harness.uiStateStore.getState().busy).toBe(false);
    expect(dialogOf(harness).kind).toBe("none");
  });

  it("leaves unaffected Documents alone and restores the tab order and active tab", async () => {
    const harness = await openedWithDocuments();
    await dirtyDocumentB(harness);
    expect(openIds(harness)).toEqual([DOCUMENT_A, DOCUMENT_B]);
    await harness.actions.openDocument(DOCUMENT_B);
    await ask(harness, [TRACKED], {
      documentIds: [DOCUMENT_A],
      projectFilesAffected: false,
    });
    harness.gateway.clearCalls();
    await confirmGitDiscard(harness.services);
    expect(harness.gateway.calls.map((call) => call.detail)).not.toContain(
      DOCUMENT_B,
    );
    expect(harness.gateway.methods(...WRITE_METHODS)).toEqual([]);
    expect(openIds(harness)).toEqual([DOCUMENT_A, DOCUMENT_B]);
    expect(harness.uiStateStore.getState().activeDocumentId).toBe(DOCUMENT_B);
    // B keeps its unsaved edit and its history.
    expect(
      harness.store.getState().documents.get(DOCUMENT_B)?.history.canUndo,
    ).toBe(true);
  });

  it("reports a failed discard once, reopens the Documents and reads the status again", async () => {
    const harness = await openedWithDocuments();
    await ask(harness, [TRACKED], {
      documentIds: [DOCUMENT_A],
      projectFilesAffected: false,
    });
    const statusReadsBefore = harness.gitGateway.calls.length;
    harness.gitGateway.nextDiscardResult = operationErr(
      "gitDiscardRejected",
      "no",
    );
    await confirmGitDiscard(harness.services);
    expect(discardErrors(harness)).toHaveLength(1);
    expect(openIds(harness).sort()).toEqual([DOCUMENT_A, DOCUMENT_B].sort());
    expect(harness.gitGateway.calls.length).toBeGreaterThan(statusReadsBefore);
    expect(harness.uiStateStore.getState().busy).toBe(false);
  });

  it("retargets the diff tabs to the new status", async () => {
    const harness = await openedWithDocuments();
    openDiffPinned(harness.services, { path: TRACKED.path, side: "unstaged" });
    await settle();
    expect(harness.uiStateStore.getState().diffTabs).toHaveLength(1);
    await ask(harness, [TRACKED], {
      documentIds: [],
      projectFilesAffected: false,
    });
    // The status git returns no longer lists the file.
    harness.gitGateway.status = {
      repositoryState: "ready",
      branch: null,
      files: [],
    };
    await confirmGitDiscard(harness.services);
    expect(harness.uiStateStore.getState().diffTabs).toEqual([]);
    expect(harness.uiStateStore.getState().activeMainTab.kind).toBe("document");
  });

  it("runs once for two quick confirmations", async () => {
    const harness = await openedWithDocuments();
    await ask(harness, [TRACKED], {
      documentIds: [DOCUMENT_A],
      projectFilesAffected: false,
    });
    await Promise.all([
      confirmGitDiscard(harness.services),
      confirmGitDiscard(harness.services),
    ]);
    expect(harness.gitGateway.discardCalls).toHaveLength(1);
  });
});

describe("confirming with project files", () => {
  it("saves everything first, discards, reopens the Project and then the Documents", async () => {
    const harness = await openedWithDocuments();
    await dirtyDocumentB(harness);
    await makeDocumentADirty(harness);
    await ask(harness, [{ path: "project.json", untracked: false }], {
      documentIds: [DOCUMENT_A],
      projectFilesAffected: true,
    });
    harness.gateway.clearCalls();
    const release = harness.gitGateway.holdNextDiscard();
    const confirmed = confirmGitDiscard(harness.services);
    await settle();
    // Before git runs: B (unaffected) is saved, A (affected) is not.
    expect(harness.gitGateway.discardCalls).toHaveLength(1);
    const saved = harness.gateway.calls.filter(
      (call) => call.method === "saveDocument" || call.method === "saveSheet",
    );
    expect(saved.length).toBeGreaterThan(0);
    expect(harness.gateway.methods("reloadProject")).toEqual([]);
    release();
    await confirmed;
    expect(harness.gateway.methods("reloadProject")).toEqual(["reloadProject"]);
    expect(openIds(harness).sort()).toEqual([DOCUMENT_A, DOCUMENT_B].sort());
    expect(openIds(harness)).toEqual([DOCUMENT_A, DOCUMENT_B]);
    expect(harness.uiStateStore.getState().activeDocumentId).toBe(DOCUMENT_A);
    expect(
      harness.store.getState().documents.get(DOCUMENT_A)?.history.canUndo,
    ).toBe(false);
  });

  it("restores the diff tabs the Project reopen cleared", async () => {
    const harness = await openedWithDocuments();
    openDiffPinned(harness.services, { path: "kept.md", side: "unstaged" });
    harness.gitGateway.status = {
      repositoryState: "ready",
      branch: null,
      files: [
        {
          path: "kept.md",
          indexStatus: "unmodified",
          worktreeStatus: "modified",
          originalPath: null,
        },
      ],
    };
    await ask(harness, [{ path: "project.json", untracked: false }], {
      documentIds: [],
      projectFilesAffected: true,
    });
    await confirmGitDiscard(harness.services);
    expect(harness.uiStateStore.getState().diffTabs.map((t) => t.path)).toEqual(
      ["kept.md"],
    );
    expect(harness.uiStateStore.getState().activeMainTab.kind).toBe("diff");
  });

  it("does not discard when saving fails, and brings the closed Documents back", async () => {
    const harness = await openedWithDocuments();
    await dirtyDocumentB(harness);
    await ask(harness, [{ path: "project.json", untracked: false }], {
      documentIds: [DOCUMENT_A],
      projectFilesAffected: true,
    });
    harness.gateway.failAlways("saveSheet", "ioError");
    harness.gateway.failAlways("saveDocument", "ioError");
    await confirmGitDiscard(harness.services);
    expect(harness.gitGateway.discardCalls).toEqual([]);
    expect(openIds(harness).sort()).toEqual([DOCUMENT_A, DOCUMENT_B].sort());
    expect(harness.gateway.methods("reloadProject")).toEqual([]);
    expect(harness.uiStateStore.getState().busy).toBe(false);
  });

  it("does not reopen a Document the reopened Project no longer has", async () => {
    const harness = await openedWithDocuments();
    await ask(harness, [TRACKED], {
      documentIds: [DOCUMENT_A],
      projectFilesAffected: true,
    });
    harness.gateway.disk.documents.delete(DOCUMENT_A);
    harness.gateway.disk.childOrder = harness.gateway.disk.childOrder.filter(
      (entryId) => entryId !== DOCUMENT_A,
    );
    harness.gateway.clearCalls();
    await confirmGitDiscard(harness.services);
    expect(openIds(harness)).toEqual([DOCUMENT_B]);
    expect(
      harness.gateway.calls
        .filter((call) => call.method === "loadDocument")
        .map((call) => call.detail),
    ).not.toContain(DOCUMENT_A);
    expect(harness.uiStateStore.getState().operationErrors).toEqual([]);
  });

  it("does not reopen the Project after a failed discard", async () => {
    const harness = await openedWithDocuments();
    await ask(harness, [{ path: "project.json", untracked: false }], {
      documentIds: [],
      projectFilesAffected: true,
    });
    harness.gateway.clearCalls();
    harness.gitGateway.nextDiscardResult = operationErr(
      "gitDiscardRejected",
      "no",
    );
    await confirmGitDiscard(harness.services);
    expect(harness.gateway.methods("reloadProject")).toEqual([]);
    expect(discardErrors(harness)).toHaveLength(1);
  });
});

describe("reopening the Project", () => {
  it("reads it again from disk by its id, without any folder selection", async () => {
    const harness = await openedActionsHarness();
    harness.gateway.clearCalls();
    const result = await harness.actions.reopenProject();
    expect(result).toEqual({ ok: true, value: true });
    expect(harness.gateway.methods()).toEqual(["reloadProject"]);
    expect(harness.store.getState().project).not.toBeNull();
  });

  it("reports a failed reload and closes the Project so no stale tree stays", async () => {
    const harness = await openedActionsHarness();
    harness.gateway.failOn("reloadProject", "ioError");
    const result = await harness.actions.reopenProject();
    expect(result).toEqual({ ok: true, value: false });
    expect(harness.store.getState().project).toBeNull();
    expect(
      harness.uiStateStore
        .getState()
        .operationErrors.map((entry) => entry.operation),
    ).toEqual(["openProject"]);
  });
});
