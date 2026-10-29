import { describe, expect, it } from "vitest";
import { parseProjectId } from "../../domain/shared/entity-id";
import { unwrap } from "../../domain/shared/test-support";
import { createBlocksCommand } from "../commands/file-backed-commands";
import { renameSheetCommand } from "../commands/naming-commands";
import type { ProjectFilesNotice } from "../ports/app-request-source";
import { operationOk } from "../ports/operation-error";
import type { ChangedFile, ExternalChanges } from "../ports/persistence-types";
import {
  blockIdOf,
  displayName,
  position,
  settle,
  size,
} from "../test-support/fakes";
import {
  DOCUMENT_A,
  DOCUMENT_B,
  openedDocumentA,
  SHEET_A1,
  type WorkspaceHarness,
} from "../test-support/workspace-harness";
import {
  createExternalChangeController,
  type ExternalChangeController,
  type ExternalChangeEvent,
} from "./external-change-controller";

// A valid project id that is not the fixture's.
const OTHER_PROJECT_ID = unwrap(
  parseProjectId("01928f3a-aaaa-7bbb-8ccc-0123456789ab"),
);

const MARKDOWN_FILE: ChangedFile = {
  path: "sheets/a1/blocks/markdown-1.md",
  change: "modified",
  readable: true,
};
const SHEET_FILE: ChangedFile = {
  path: "sheets/a1/sheet.json",
  change: "modified",
  readable: true,
};

interface Setup {
  readonly harness: WorkspaceHarness;
  readonly controller: ExternalChangeController;
  readonly events: ExternalChangeEvent[];
  readonly reloaded: string[];
  readonly state: { blocked: boolean; pendingDraft: boolean };
  readonly saveAllCalls: { count: number };
}

function setup(harness: WorkspaceHarness): Setup {
  const events: ExternalChangeEvent[] = [];
  const reloaded: string[] = [];
  const state = { blocked: false, pendingDraft: false };
  const saveAllCalls = { count: 0 };
  const controller = createExternalChangeController({
    gateway: harness.gateway,
    applicationStore: harness.store,
    getDocumentSession: (documentId) =>
      harness.workspace.getDocumentSession(documentId),
    hasPendingDraft: () => state.pendingDraft,
    reload: {
      document: async (documentId) => {
        reloaded.push(`document:${documentId}`);
        return operationOk(undefined);
      },
      project: async () => {
        reloaded.push("project");
        return operationOk(undefined);
      },
    },
    saveAll: async () => {
      saveAllCalls.count += 1;
      return operationOk(undefined);
    },
    isBlocked: () => state.blocked,
    onEvent: (event) => events.push(event),
  });
  return { harness, controller, events, reloaded, state, saveAllCalls };
}

async function opened(): Promise<Setup> {
  return setup(await openedDocumentA());
}

function generationOf(harness: WorkspaceHarness): number {
  const generation = harness.store.getState().project?.sessionGeneration;
  if (generation === undefined) throw new Error("no project");
  return generation;
}

function changes(
  harness: WorkspaceHarness,
  overrides: Partial<ExternalChanges> = {},
): ExternalChanges {
  return {
    sessionGeneration: generationOf(harness),
    watching: true,
    rescan: false,
    project: { structure: false, files: [] },
    documents: [],
    ...overrides,
  };
}

function documentChanges(
  files: readonly ChangedFile[],
  documentId = DOCUMENT_A,
) {
  return { documents: [{ documentId, files }] };
}

function notice(
  harness: WorkspaceHarness,
  overrides: Partial<ExternalChanges> = {},
): ProjectFilesNotice {
  const project = harness.store.getState().project;
  if (project === null) throw new Error("no project");
  return { projectId: project.projectId, changes: changes(harness, overrides) };
}

async function makeUnsaved(harness: WorkspaceHarness): Promise<void> {
  harness.autoSaveController.applyExternal(false);
  await harness.workspace
    .getDocumentSession(DOCUMENT_A)
    ?.execute(renameSheetCommand(SHEET_A1, displayName("Unsaved")));
}

describe("a change in a Document with nothing unsaved", () => {
  it("reads the Document again without asking", async () => {
    const { harness, controller, events, reloaded } = await opened();
    await controller.handleNotice(
      notice(harness, documentChanges([MARKDOWN_FILE])),
    );
    expect(reloaded).toEqual([`document:${DOCUMENT_A}`]);
    expect(controller.store.getState().conflicts).toEqual([]);
    expect(events).toContainEqual({
      type: "reloaded",
      target: { kind: "document", documentId: DOCUMENT_A },
    });
  });

  it("asks instead when something that changed cannot be read", async () => {
    const { harness, controller, reloaded } = await opened();
    const unreadable: ChangedFile = { ...SHEET_FILE, readable: false };
    await controller.handleNotice(
      notice(harness, documentChanges([MARKDOWN_FILE, unreadable])),
    );
    expect(reloaded).toEqual([]);
    expect(controller.store.getState().conflicts).toEqual([
      {
        documentId: DOCUMENT_A,
        files: [MARKDOWN_FILE, unreadable],
        status: "conflict",
      },
    ]);
  });

  it("asks instead when text is still being typed", async () => {
    const { harness, controller, reloaded, state } = await opened();
    state.pendingDraft = true;
    await controller.handleNotice(
      notice(harness, documentChanges([MARKDOWN_FILE])),
    );
    expect(reloaded).toEqual([]);
    expect(controller.store.getState().conflicts).toHaveLength(1);
  });

  it("reports a Document that is not open as nothing to do", async () => {
    const { harness, controller, reloaded } = await opened();
    await controller.handleNotice(
      notice(harness, documentChanges([MARKDOWN_FILE], DOCUMENT_B)),
    );
    expect(reloaded).toEqual([]);
    expect(controller.store.getState().conflicts).toEqual([]);
  });
});

describe("a change in a Document with unsaved changes", () => {
  it("stops saving that Document and records the conflict", async () => {
    const { harness, controller, reloaded } = await opened();
    await makeUnsaved(harness);
    await controller.handleNotice(
      notice(harness, documentChanges([MARKDOWN_FILE])),
    );
    expect(reloaded).toEqual([]);
    const conflict = controller.store.getState().conflicts[0];
    expect(conflict).toMatchObject({
      documentId: DOCUMENT_A,
      status: "conflict",
    });
    harness.gateway.clearCalls();
    const flushed = await harness.workspace
      .getDocumentSession(DOCUMENT_A)
      ?.flush();
    expect(flushed?.ok).toBe(false);
    expect(harness.gateway.methods("saveSheet")).toEqual([]);
  });

  it("merges later changes into the same conflict instead of adding another", async () => {
    const { harness, controller } = await opened();
    await makeUnsaved(harness);
    await controller.handleNotice(
      notice(harness, documentChanges([MARKDOWN_FILE])),
    );
    const removedSheet: ChangedFile = {
      ...SHEET_FILE,
      change: "removed",
      readable: false,
    };
    await controller.handleNotice(
      notice(harness, documentChanges([MARKDOWN_FILE, removedSheet])),
    );
    const { conflicts } = controller.store.getState();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.files).toEqual([MARKDOWN_FILE, removedSheet]);
  });

  it("keeps saving stopped when the user keeps the current content", async () => {
    const { harness, controller } = await opened();
    await makeUnsaved(harness);
    await controller.handleNotice(
      notice(harness, documentChanges([MARKDOWN_FILE])),
    );
    controller.keepCurrent({ kind: "document", documentId: DOCUMENT_A });
    expect(controller.store.getState().conflicts[0]?.status).toBe("kept");
    const flushed = await harness.workspace
      .getDocumentSession(DOCUMENT_A)
      ?.flush();
    expect(flushed?.ok).toBe(false);
  });

  it("reads the Document again when the user chooses to reload", async () => {
    const { harness, controller, reloaded } = await opened();
    await makeUnsaved(harness);
    await controller.handleNotice(
      notice(harness, documentChanges([MARKDOWN_FILE])),
    );
    const result = await controller.reload({
      kind: "document",
      documentId: DOCUMENT_A,
    });
    expect(result.ok).toBe(true);
    expect(reloaded).toEqual([`document:${DOCUMENT_A}`]);
    expect(controller.store.getState().conflicts).toEqual([]);
  });

  it("accepts the disk state and saves when the user overwrites", async () => {
    const { harness, controller } = await opened();
    await makeUnsaved(harness);
    await controller.handleNotice(
      notice(harness, documentChanges([SHEET_FILE])),
    );
    harness.gateway.clearCalls();
    const result = await controller.overwrite({
      kind: "document",
      documentId: DOCUMENT_A,
    });
    expect(result.ok).toBe(true);
    expect(harness.gateway.methods("acceptDiskState", "saveSheet")[0]).toBe(
      "acceptDiskState",
    );
    expect(harness.gateway.acceptedDiskStates).toEqual([DOCUMENT_A]);
    expect(harness.gateway.methods("saveSheet").length).toBeGreaterThan(0);
    expect(controller.store.getState().conflicts).toEqual([]);
    expect(
      harness.workspace.getDocumentSession(DOCUMENT_A)?.getState().save
        .lastError,
    ).toBeNull();
  });

  it("writes a removed text file again from memory when overwriting", async () => {
    const { harness, controller } = await opened();
    const session = harness.workspace.getDocumentSession(DOCUMENT_A);
    await session?.execute(
      createBlocksCommand(SHEET_A1, [
        {
          blockId: blockIdOf(10),
          blockType: "markdown",
          position: position(1, 1),
          size: size(100, 80),
          text: "alpha",
        },
      ]),
    );
    const contentPath = [
      ...(session?.getState().sheets.get(SHEET_A1)?.blocks ?? []),
    ][0]?.contentPath;
    expect(contentPath).toBeDefined();
    await makeUnsaved(harness);
    const removed: ChangedFile = {
      path: contentPath ?? "",
      change: "removed",
      readable: false,
    };
    await controller.handleNotice(notice(harness, documentChanges([removed])));
    harness.gateway.clearCalls();
    await controller.overwrite({ kind: "document", documentId: DOCUMENT_A });
    expect(
      harness.gateway.methods("acceptDiskState", "restoreBlockContent"),
    ).toEqual(["acceptDiskState", "restoreBlockContent"]);
  });
});

describe("a change at the Project level", () => {
  const projectFile: ChangedFile = {
    path: "project.json",
    change: "modified",
    readable: true,
  };

  it("reads the Project again when it is readable and nothing at all is unsaved", async () => {
    const { harness, controller, reloaded } = await opened();
    await controller.handleNotice(
      notice(harness, { project: { structure: false, files: [projectFile] } }),
    );
    expect(reloaded).toEqual(["project"]);
  });

  it("never reads the Project again unasked for a structural change", async () => {
    const { harness, controller, reloaded } = await opened();
    await controller.handleNotice(
      notice(harness, { project: { structure: true, files: [] } }),
    );
    expect(reloaded).toEqual([]);
    expect(controller.store.getState().projectConflict).toEqual({
      structure: true,
      files: [],
      status: "conflict",
    });
  });

  it("asks when any Document has unsaved changes, because a reload would drop them", async () => {
    const { harness, controller, reloaded } = await opened();
    await makeUnsaved(harness);
    await controller.handleNotice(
      notice(harness, { project: { structure: false, files: [projectFile] } }),
    );
    expect(reloaded).toEqual([]);
    expect(controller.store.getState().projectConflict?.files).toEqual([
      projectFile,
    ]);
  });

  it("accepts the Project files and saves everything when overwriting", async () => {
    const { harness, controller, saveAllCalls } = await opened();
    await makeUnsaved(harness);
    await controller.handleNotice(
      notice(harness, { project: { structure: false, files: [projectFile] } }),
    );
    await controller.overwrite({ kind: "project" });
    expect(harness.gateway.acceptedDiskStates).toEqual([null]);
    expect(saveAllCalls.count).toBe(1);
    expect(controller.store.getState().projectConflict).toBeNull();
  });
});

describe("stale and foreign notices", () => {
  it("drops a notice made for another read of the Project", async () => {
    const { harness, controller, reloaded } = await opened();
    await controller.handleNotice(
      notice(harness, {
        ...documentChanges([MARKDOWN_FILE]),
        sessionGeneration: generationOf(harness) - 1,
      }),
    );
    expect(reloaded).toEqual([]);
  });

  it("drops a notice for another Project", async () => {
    const { harness, controller, reloaded } = await opened();
    const foreign: ProjectFilesNotice = {
      projectId: OTHER_PROJECT_ID,
      changes: changes(harness, documentChanges([MARKDOWN_FILE])),
    };
    await controller.handleNotice(foreign);
    expect(reloaded).toEqual([]);
  });

  it("forgets conflicts when the Project is read again", async () => {
    const { harness, controller } = await opened();
    await makeUnsaved(harness);
    await controller.handleNotice(
      notice(harness, documentChanges([MARKDOWN_FILE])),
    );
    expect(controller.store.getState().conflicts).toHaveLength(1);
    await harness.workspace.reloadProject({ discardChanges: true });
    expect(controller.store.getState().conflicts).toEqual([]);
  });

  it("forgets the conflict of a Document that was closed", async () => {
    const { harness, controller } = await opened();
    await makeUnsaved(harness);
    await controller.handleNotice(
      notice(harness, documentChanges([MARKDOWN_FILE])),
    );
    await harness.workspace.closeDocument(DOCUMENT_A, { discardChanges: true });
    expect(controller.store.getState().conflicts).toEqual([]);
  });
});

describe("checking and waiting", () => {
  it("compares with the disk and handles the result like a notice", async () => {
    const { harness, controller, reloaded } = await opened();
    harness.gateway.setExternalChanges(
      changes(harness, documentChanges([MARKDOWN_FILE])),
    );
    await controller.check();
    expect(harness.gateway.methods("checkExternalChanges")).toHaveLength(1);
    expect(reloaded).toEqual([`document:${DOCUMENT_A}`]);
  });

  it("holds changes while something else rewrites files, then compares again", async () => {
    const { harness, controller, reloaded, state } = await opened();
    state.blocked = true;
    await controller.handleNotice(
      notice(harness, documentChanges([MARKDOWN_FILE])),
    );
    expect(reloaded).toEqual([]);
    expect(harness.gateway.methods("checkExternalChanges")).toEqual([]);
    harness.gateway.setExternalChanges(
      changes(harness, documentChanges([MARKDOWN_FILE])),
    );
    state.blocked = false;
    await controller.resume();
    expect(harness.gateway.methods("checkExternalChanges")).toHaveLength(1);
    expect(reloaded).toEqual([`document:${DOCUMENT_A}`]);
  });

  it("does not compare again after a block that held nothing", async () => {
    const { harness, controller } = await opened();
    await controller.resume();
    await settle();
    expect(harness.gateway.methods("checkExternalChanges")).toEqual([]);
  });

  it("reports that the watcher is not running once per read of the Project", async () => {
    const { harness, controller, events } = await opened();
    await controller.handleNotice(notice(harness, { watching: false }));
    await controller.handleNotice(notice(harness, { watching: false }));
    expect(
      events.filter((event) => event.type === "watchUnavailable"),
    ).toHaveLength(1);
  });

  it("reports activity for every notice, even one with nothing to reload", async () => {
    const { harness, controller, events } = await opened();
    await controller.handleNotice(notice(harness));
    expect(events).toContainEqual({ type: "projectFilesActivity" });
  });

  it("reports a failed comparison", async () => {
    const { harness, controller, events } = await opened();
    harness.gateway.failOn("checkExternalChanges", "ioError");
    await controller.check();
    expect(events).toContainEqual({
      type: "checkFailed",
      error: expect.objectContaining({ kind: "ioError" }),
    });
  });
});
