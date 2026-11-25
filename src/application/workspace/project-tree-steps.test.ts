import { describe, expect, it } from "vitest";
import type { EntryId, FolderId } from "../../domain/shared/entity-id";
import {
  type OperationResult,
  operationErr,
  operationOk,
} from "../ports/operation-error";
import type { PersistenceGateway } from "../ports/persistence-gateway";
import type { OpenProjectState } from "../state/application-state";
import {
  createSequentialIdGenerator,
  documentIdOf,
  folderIdOf,
} from "../test-support/fakes";
import {
  DOCUMENT_A,
  DOCUMENT_C,
  DOCUMENT_D,
  FOLDER_1,
  FOLDER_2,
  openedFolderDiskWorkspace,
} from "../test-support/workspace-harness";
import { CLEAN_SAVE } from "./project-entries";
import { createProjectTreeSteps } from "./project-tree-steps";

// (root)  FOLDER_1, DOCUMENT_A, DOCUMENT_B
// FOLDER_1  FOLDER_2, DOCUMENT_C
// FOLDER_2  DOCUMENT_D
async function stepsOver(
  change: (project: OpenProjectState) => OpenProjectState = (project) =>
    project,
  overrides: Partial<PersistenceGateway> = {},
) {
  const harness = await openedFolderDiskWorkspace();
  const opened = harness.store.getState().project;
  if (opened === null) throw new Error("no project");
  let state: OpenProjectState | null = change(opened);
  const gateway = { ...harness.gateway, ...overrides } as PersistenceGateway;
  const steps = createProjectTreeSteps({
    gateway,
    idGenerator: createSequentialIdGenerator(0x5000),
    requireProject: () =>
      state === null
        ? operationErr("projectNotOpen", "closed")
        : operationOk(state),
    updateProject: (update) => {
      if (state !== null) state = update(state);
    },
    saveCurrentProject: async () => operationOk(undefined),
  });
  return {
    steps,
    harness,
    current: () => state,
    close: () => {
      state = null;
    },
    replace: (next: OpenProjectState) => {
      state = next;
    },
  };
}

const folderOf = (project: OpenProjectState | null, folderId: FolderId) =>
  project?.folders.find((entry) => entry.folderId === folderId);

const withFolder = (
  project: OpenProjectState,
  folderId: FolderId,
  change: (
    entry: OpenProjectState["folders"][number],
  ) => OpenProjectState["folders"][number],
): OpenProjectState => ({
  ...project,
  folders: project.folders.map((entry) =>
    entry.folderId === folderId ? change(entry) : entry,
  ),
});

describe("without an open Project", () => {
  it("refuses every step, and has no dirty folders to save", async () => {
    const context = await stepsOver();
    context.close();
    const { steps } = context;
    for (const result of [
      await steps.saveOrderOf(null, []),
      await steps.saveFolder(FOLDER_1),
      await steps.createFolder(null, "New"),
      await steps.renameFolder(FOLDER_1, "New"),
      await steps.reorder("document", DOCUMENT_A, null),
      await steps.moveEntry(DOCUMENT_A, FOLDER_1),
      await steps.deleteFolder(FOLDER_2),
    ]) {
      expect(result.ok).toBe(false);
    }
    expect((await steps.saveDirtyFolders(true)).ok).toBe(true);
  });
});

describe("saving orders and folders", () => {
  it("refuses an unknown folder and one that did not load", async () => {
    const { steps } = await stepsOver((project) =>
      withFolder(project, FOLDER_2, (entry) => ({
        ...entry,
        state: "loadFailed",
      })),
    );
    expect((await steps.saveOrderOf(folderIdOf(90), [])).ok).toBe(false);
    expect((await steps.saveOrderOf(FOLDER_2, [])).ok).toBe(false);
    expect((await steps.saveFolder(folderIdOf(90))).ok).toBe(false);
  });

  it("does not bring back a folder that went away while it was saved", async () => {
    let context: Awaited<ReturnType<typeof stepsOver>> | null = null;
    context = await stepsOver(undefined, {
      saveFolder: async () => {
        const current = context?.current();
        if (current) {
          context?.replace({
            ...current,
            folders: current.folders.filter(
              (entry) => entry.folderId !== FOLDER_2,
            ),
          });
        }
        return operationOk(undefined);
      },
    });
    expect((await context.steps.saveFolder(FOLDER_2)).ok).toBe(true);
    expect(folderOf(context.current(), FOLDER_2)).toBeUndefined();
  });

  it("saves every dirty folder, or stops at the first failure", async () => {
    const dirty = (project: OpenProjectState) =>
      [FOLDER_1, FOLDER_2].reduce(
        (next, folderId) =>
          withFolder(next, folderId, (entry) => ({
            ...entry,
            save: { dirty: true, lastError: null },
          })),
        project,
      );
    let calls = 0;
    const failing = {
      saveFolder: async (): Promise<OperationResult<void>> => {
        calls += 1;
        return operationErr("ioError", "disk full");
      },
    };
    const { steps } = await stepsOver(dirty, failing);
    expect((await steps.saveDirtyFolders(false)).ok).toBe(false);
    expect(calls).toBe(2);
    calls = 0;
    const stopping = await stepsOver(dirty, failing);
    expect((await stopping.steps.saveDirtyFolders(true)).ok).toBe(false);
    expect(calls).toBe(1);
  });
});

describe("creating a folder", () => {
  it("refuses a folder Rust did not create as asked", async () => {
    const { steps } = await stepsOver(undefined, {
      createFolder: async (_projectId, parentFolderId) =>
        operationOk({
          folderId: folderIdOf(91),
          name: "Other",
          parentFolderId,
          childOrder: [],
          state: "loaded",
        }),
    });
    expect((await steps.createFolder(null, "New")).ok).toBe(false);
  });

  it("refuses when the Project closed meanwhile, or the parent already lists the folder", async () => {
    let context: Awaited<ReturnType<typeof stepsOver>> | null = null;
    const create = (after: () => void): Partial<PersistenceGateway> => ({
      createFolder: async (_projectId, parentFolderId, folderId, name) => {
        after();
        return operationOk({
          folderId,
          name,
          parentFolderId,
          childOrder: [],
          state: "loaded",
        });
      },
    });
    context = await stepsOver(
      undefined,
      create(() => context?.close()),
    );
    expect((await context.steps.createFolder(null, "New")).ok).toBe(false);
    context = await stepsOver(
      undefined,
      create(() => {
        const current = context?.current();
        if (current) {
          context?.replace({
            ...current,
            project: {
              ...current.project,
              childOrder: [
                ...current.project.childOrder,
                createSequentialIdGenerator(0x5000).folderId() as EntryId,
              ],
            },
          });
        }
      }),
    );
    expect((await context.steps.createFolder(null, "New")).ok).toBe(false);
  });
});

describe("reordering", () => {
  it("reorders folders, and refuses an entry whose parent is unknown or a place not in the order", async () => {
    const { steps, current } = await stepsOver((project) => ({
      ...project,
      folders: [
        ...project.folders,
        {
          ...(folderOf(
            project,
            FOLDER_2,
          ) as OpenProjectState["folders"][number]),
          folderId: folderIdOf(70),
          parentFolderId: FOLDER_1,
          childOrder: [],
        },
      ].map((entry) =>
        entry.folderId === FOLDER_1
          ? {
              ...entry,
              childOrder: [...entry.childOrder, folderIdOf(70) as EntryId],
            }
          : entry,
      ),
      documents: [
        ...project.documents,
        {
          documentId: documentIdOf(71),
          parentFolderId: folderIdOf(72),
          name: "Lost",
          state: "loaded" as const,
          save: CLEAN_SAVE,
        } as never,
      ],
    }));
    expect((await steps.reorder("folder", folderIdOf(70), FOLDER_2)).ok).toBe(
      true,
    );
    expect(folderOf(current(), FOLDER_1)?.childOrder[0]).toBe(folderIdOf(70));
    expect((await steps.reorder("document", documentIdOf(71), null)).ok).toBe(
      false,
    );
    expect(
      (await steps.reorder("document", DOCUMENT_C, documentIdOf(73))).ok,
    ).toBe(false);
  });
});

describe("moving an entry", () => {
  it("refuses when the Project closed meanwhile", async () => {
    let context: Awaited<ReturnType<typeof stepsOver>> | null = null;
    context = await stepsOver(undefined, {
      moveEntry: async () => {
        context?.close();
        return operationOk(undefined);
      },
    });
    expect((await context.steps.moveEntry(DOCUMENT_A, FOLDER_2)).ok).toBe(
      false,
    );
  });

  it("moves an entry its parent does not list, saving only the target", async () => {
    const { steps, current } = await stepsOver((project) => ({
      ...project,
      project: {
        ...project.project,
        childOrder: project.project.childOrder.filter(
          (id) => id !== DOCUMENT_A,
        ),
      },
    }));
    expect((await steps.moveEntry(DOCUMENT_A, FOLDER_2)).ok).toBe(true);
    expect(folderOf(current(), FOLDER_2)?.childOrder).toContain(DOCUMENT_A);
  });

  it("refuses an entry whose parent is unknown, and a target that already lists it", async () => {
    const lost = await stepsOver((project) => ({
      ...project,
      documents: project.documents.map((entry) =>
        entry.documentId === DOCUMENT_D
          ? { ...entry, parentFolderId: folderIdOf(72) }
          : entry,
      ),
    }));
    expect((await lost.steps.moveEntry(DOCUMENT_D, null)).ok).toBe(false);
    const listed = await stepsOver((project) =>
      withFolder(project, FOLDER_2, (entry) => ({
        ...entry,
        childOrder: [...entry.childOrder, DOCUMENT_A],
      })),
    );
    expect((await listed.steps.moveEntry(DOCUMENT_A, FOLDER_2)).ok).toBe(false);
  });
});

describe("deleting a folder", () => {
  it("refuses an unknown folder and one whose parent is unknown", async () => {
    const { steps } = await stepsOver((project) => ({
      ...project,
      folders: [
        ...project.folders,
        {
          ...(folderOf(
            project,
            FOLDER_2,
          ) as OpenProjectState["folders"][number]),
          folderId: folderIdOf(80),
          parentFolderId: folderIdOf(81),
          childOrder: [],
        },
      ],
    }));
    expect((await steps.deleteFolder(folderIdOf(82))).ok).toBe(false);
    expect((await steps.deleteFolder(folderIdOf(80))).ok).toBe(false);
  });

  it("deletes a folder its parent does not list, and keeps it when the directory cannot go", async () => {
    const unlisted = (project: OpenProjectState) => ({
      ...project,
      folders: [
        ...project.folders,
        {
          ...(folderOf(
            project,
            FOLDER_2,
          ) as OpenProjectState["folders"][number]),
          folderId: folderIdOf(83),
          parentFolderId: null,
          childOrder: [],
        },
      ],
    });
    const deleted = await stepsOver(unlisted, {
      deleteFolder: async () => operationOk(undefined),
    });
    expect((await deleted.steps.deleteFolder(folderIdOf(83))).ok).toBe(true);
    expect(folderOf(deleted.current(), folderIdOf(83))).toBeUndefined();
    const failing = await stepsOver(unlisted, {
      deleteFolder: async () => operationErr("ioError", "in use"),
    });
    expect((await failing.steps.deleteFolder(folderIdOf(83))).ok).toBe(false);
    expect(failing.current()?.save.dirty).toBe(false);
  });
});
