// A workspace wired to the fakes, with a seeded fake disk and every emitted event
// collected. Documents A and B load fine; FAILED_DOCUMENT_ID's own metadata is broken.

import { LAYOUT_CONFIG } from "../../config/layout-config";
import { DEFAULT_AUTO_SAVE_ENABLED } from "../../config/session-config";
import { parseProject } from "../../domain/project/project";
import { PROJECT_ID } from "../../domain/shared/test-fixtures";
import { unwrap } from "../../domain/shared/test-support";
import type { OperationResult } from "../ports/operation-error";
import type { LoadIssue, ProjectSnapshot } from "../ports/persistence-types";
import {
  type AutoSaveController,
  createAutoSaveController,
} from "../settings/auto-save-controller";
import {
  createLayoutSettingsController,
  type LayoutSettingsController,
} from "../settings/layout-settings-controller";
import {
  type ApplicationStore,
  createApplicationStore,
} from "../state/application-state";
import { createWorkspace, type Workspace } from "../workspace/workspace";
import type { WorkspaceEvent } from "../workspace/workspace-events";
import {
  createFakeAppSettingsGateway,
  type FakeAppSettingsGateway,
} from "./fake-theme";
import {
  createFakeGateway,
  createFakeScheduler,
  createSequentialIdGenerator,
  documentIdOf,
  type FakeGateway,
  type FakeScheduler,
  folderIdOf,
  sheetIdOf,
} from "./fakes";
import { TEST_AUTO_SAVE_DELAY_MS } from "./session-harness";

export const SELECTION_ID = "selection-1";
export const DOCUMENT_A = documentIdOf(1);
export const DOCUMENT_B = documentIdOf(2);
export const FAILED_DOCUMENT_ID = documentIdOf(3);
export const SHEET_A1 = sheetIdOf(1);
export const SHEET_A2 = sheetIdOf(2);
export const FAILED_SHEET_ID = sheetIdOf(3);
export const SHEET_B1 = sheetIdOf(4);

export const DOCUMENT_A_ISSUE: LoadIssue = {
  kind: "orphanContent",
  path: "documents/a/sheets/s/blocks/stray.md",
  entityId: null,
  detail: "not referenced",
};

export interface WorkspaceHarness {
  readonly workspace: Workspace;
  readonly gateway: FakeGateway;
  readonly scheduler: FakeScheduler;
  readonly store: ApplicationStore;
  readonly events: WorkspaceEvent[];
  // The auto-save policy of the workspace; on until a test switches it off.
  readonly autoSaveController: AutoSaveController;
  // The Project Tree width setting, over the same fake settings file.
  readonly layoutSettingsController: LayoutSettingsController;
  readonly settingsGateway: FakeAppSettingsGateway;
}

export function createWorkspaceHarness(): WorkspaceHarness {
  const gateway = createFakeGateway();
  gateway.seedDocument({
    documentId: DOCUMENT_A,
    name: "Document A",
    issues: [DOCUMENT_A_ISSUE],
    sheets: [
      { sheetId: SHEET_A1, name: "Sheet A1" },
      { sheetId: SHEET_A2, name: "Sheet A2" },
      { sheetId: FAILED_SHEET_ID, state: "loadFailed" },
    ],
  });
  gateway.seedDocument({
    documentId: DOCUMENT_B,
    name: "Document B",
    sheets: [{ sheetId: SHEET_B1, name: "Sheet B1" }],
  });
  gateway.seedDocument({ documentId: FAILED_DOCUMENT_ID, state: "loadFailed" });
  const scheduler = createFakeScheduler();
  const store = createApplicationStore();
  const events: WorkspaceEvent[] = [];
  const settingsGateway = createFakeAppSettingsGateway();
  const autoSaveController = createAutoSaveController({
    gateway: settingsGateway,
    defaultEnabled: DEFAULT_AUTO_SAVE_ENABLED,
  });
  const layoutSettingsController = createLayoutSettingsController({
    gateway: settingsGateway,
    defaultProjectTreeWidth: LAYOUT_CONFIG.projectTree.defaultWidthPx,
  });
  const workspace = createWorkspace({
    gateway,
    scheduler,
    autoSavePolicy: autoSaveController,
    idGenerator: createSequentialIdGenerator(),
    store,
    config: { undoHistoryLimit: 50, autoSaveDelayMs: TEST_AUTO_SAVE_DELAY_MS },
  });
  workspace.subscribe((event) => events.push(event));
  return {
    workspace,
    gateway,
    scheduler,
    store,
    events,
    autoSaveController,
    layoutSettingsController,
    settingsGateway,
  };
}

export async function openedWorkspace(): Promise<WorkspaceHarness> {
  const harness = createWorkspaceHarness();
  const opened = await harness.workspace.openProject(SELECTION_ID);
  if (!opened.ok) throw new Error(`open failed: ${opened.error.kind}`);
  harness.gateway.clearCalls();
  return harness;
}

export async function openedDocumentA(): Promise<WorkspaceHarness> {
  const harness = await openedWorkspace();
  const opened = await harness.workspace.openDocument(DOCUMENT_A);
  if (!opened.ok) throw new Error(`open failed: ${opened.error.kind}`);
  harness.gateway.clearCalls();
  return harness;
}

// The error kind of a failed result, or null for a success.
export function errorKind(result: OperationResult<unknown>): string | null {
  return result.ok ? null : result.error.kind;
}

export const CONFIRMED = { confirmedByUser: true } as const;

// A project with Folders, handed to the workspace through `overrideProjectSnapshot`:
//
//   (root)  FOLDER_1, DOCUMENT_A, DOCUMENT_B
//   FOLDER_1  FOLDER_2, DOCUMENT_C
//   FOLDER_2  DOCUMENT_D
export const FOLDER_TREE_SELECTION_ID = "selection-folders";
export const FOLDER_1 = folderIdOf(1);
export const FOLDER_2 = folderIdOf(2);
export const DOCUMENT_C = documentIdOf(10);
export const DOCUMENT_D = documentIdOf(11);

export function folderTreeSnapshot(): ProjectSnapshot {
  return {
    project: unwrap(
      parseProject({
        schemaVersion: 2,
        projectId: PROJECT_ID,
        name: "Project",
        childOrder: [FOLDER_1, DOCUMENT_A, DOCUMENT_B],
      }),
    ),
    folders: [
      {
        folderId: FOLDER_1,
        name: "Folder 1",
        parentFolderId: null,
        childOrder: [FOLDER_2, DOCUMENT_C],
        state: "loaded",
      },
      {
        folderId: FOLDER_2,
        name: "Folder 2",
        parentFolderId: FOLDER_1,
        childOrder: [DOCUMENT_D],
        state: "loaded",
      },
    ],
    documents: [
      {
        documentId: DOCUMENT_A,
        parentFolderId: null,
        name: "Document A",
        state: "loaded",
      },
      {
        documentId: DOCUMENT_B,
        parentFolderId: null,
        name: "Document B",
        state: "loaded",
      },
      {
        documentId: DOCUMENT_C,
        parentFolderId: FOLDER_1,
        name: "Document C",
        state: "loaded",
      },
      {
        documentId: DOCUMENT_D,
        parentFolderId: FOLDER_2,
        name: "Document D",
        state: "loaded",
      },
    ],
    issues: [],
  };
}

// Opens `folderTreeSnapshot()` (Documents A and B exist on the fake disk, C and D do not).
export async function openedFolderTreeWorkspace(): Promise<WorkspaceHarness> {
  const harness = createWorkspaceHarness();
  harness.gateway.overrideProjectSnapshot(
    FOLDER_TREE_SELECTION_ID,
    folderTreeSnapshot(),
  );
  const opened = await harness.workspace.openProject(FOLDER_TREE_SELECTION_ID);
  if (!opened.ok) throw new Error(`open failed: ${opened.error.kind}`);
  harness.gateway.clearCalls();
  return harness;
}

// The same tree as `folderTreeSnapshot()`, but really on the fake disk, so the folder
// operations (which call the gateway) work on it. Documents C and D each have one sheet.
export const SHEET_C1 = sheetIdOf(20);
export const SHEET_D1 = sheetIdOf(21);

export function seedFolderTree(gateway: FakeGateway): void {
  gateway.seedFolder({
    folderId: FOLDER_1,
    name: "Folder 1",
    childOrder: [FOLDER_2, DOCUMENT_C],
  });
  gateway.seedFolder({
    folderId: FOLDER_2,
    name: "Folder 2",
    parentFolderId: FOLDER_1,
    childOrder: [DOCUMENT_D],
  });
  gateway.seedDocument({
    documentId: DOCUMENT_C,
    name: "Document C",
    sheets: [{ sheetId: SHEET_C1, name: "Sheet C1" }],
  });
  gateway.seedDocument({
    documentId: DOCUMENT_D,
    name: "Document D",
    sheets: [{ sheetId: SHEET_D1, name: "Sheet D1" }],
  });
  // `seedDocument` lists a document at the root; these two live in folders.
  gateway.disk.childOrder = [FOLDER_1, DOCUMENT_A, DOCUMENT_B];
  gateway.disk.documentParents.set(DOCUMENT_C, FOLDER_1);
  gateway.disk.documentParents.set(DOCUMENT_D, FOLDER_2);
}

// Opens the project of `seedFolderTree` (root: FOLDER_1, A, B). Calls are cleared.
export async function openedFolderDiskWorkspace(): Promise<WorkspaceHarness> {
  const harness = createWorkspaceHarness();
  seedFolderTree(harness.gateway);
  const opened = await harness.workspace.openProject(SELECTION_ID);
  if (!opened.ok) throw new Error(`open failed: ${opened.error.kind}`);
  harness.gateway.clearCalls();
  return harness;
}
