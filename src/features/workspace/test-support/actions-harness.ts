// A real workspace over the fake gateway plus UI state and actions, for tests of the
// workspace UI (node and DOM). Not imported by production code.

import {
  createBlocksCommand,
  deleteBlocksCommand,
} from "../../../application/commands/file-backed-commands";
import { renameSheetCommand } from "../../../application/commands/naming-commands";
import type { LoadIssue } from "../../../application/ports/persistence-types";
import {
  createFakeAppSettingsGateway,
  createFakeOsThemeSource,
} from "../../../application/test-support/fake-theme";
import {
  createFakeViewportGateway,
  type FakeViewportGateway,
} from "../../../application/test-support/fake-viewport";
import {
  blockIdOf,
  createFakeScheduler,
  displayName,
  type FakeScheduler,
  filesForBlocks,
  position,
  size,
} from "../../../application/test-support/fakes";
import {
  createWorkspaceHarness,
  DOCUMENT_A,
  SELECTION_ID,
  SHEET_A1,
  type WorkspaceHarness,
} from "../../../application/test-support/workspace-harness";
import { createThemeController } from "../../../application/theme/theme-controller";
import type { Block } from "../../../domain/block/block";
import type { DocumentId, SheetId } from "../../../domain/shared/entity-id";
import { unwrap } from "../../../domain/shared/test-support";
import { parseSheet } from "../../../domain/sheet/sheet";
import {
  type CanvasActions,
  createCanvasActions,
} from "../../canvas/canvas-actions";
import {
  createViewportPersistence,
  type ViewportPersistence,
} from "../../canvas/viewport-persistence";
import { createUiStateStore, type UiStateStore } from "../ui-state/ui-state";
import { connectWorkspaceToUiState } from "../ui-state/workspace-ui-connector";
import {
  createWorkspaceActions,
  type WorkspaceActions,
} from "../workspace-actions";
import type { WorkspaceServices } from "../workspace-services-context";

export interface ActionsHarness extends WorkspaceHarness {
  readonly uiStateStore: UiStateStore;
  readonly actions: WorkspaceActions;
  readonly canvasActions: CanvasActions;
  readonly viewportGateway: FakeViewportGateway;
  // Its own clock, so viewport saves are advanced independently of auto-save.
  readonly viewportScheduler: FakeScheduler;
  readonly viewportPersistence: ViewportPersistence;
  readonly services: WorkspaceServices;
}

export function createActionsHarness(): ActionsHarness {
  const base = createWorkspaceHarness();
  const uiStateStore = createUiStateStore();
  connectWorkspaceToUiState(base.workspace, uiStateStore);
  const actions = createWorkspaceActions({
    workspace: base.workspace,
    applicationStore: base.store,
    uiStateStore,
  });
  const canvasActions = createCanvasActions({
    workspace: base.workspace,
    applicationStore: base.store,
    uiStateStore,
  });
  const viewportGateway = createFakeViewportGateway();
  const viewportScheduler = createFakeScheduler();
  const viewportPersistence = createViewportPersistence({
    gateway: viewportGateway,
    scheduler: viewportScheduler,
    applicationStore: base.store,
    uiStateStore,
  });
  const themeController = createThemeController({
    gateway: createFakeAppSettingsGateway(),
    osThemeSource: createFakeOsThemeSource("light"),
  });
  return {
    ...base,
    uiStateStore,
    actions,
    canvasActions,
    viewportGateway,
    viewportScheduler,
    viewportPersistence,
    services: {
      applicationStore: base.store,
      uiStateStore,
      actions,
      canvasActions,
      themeController,
    },
  };
}

export async function openedActionsHarness(): Promise<ActionsHarness> {
  const harness = createActionsHarness();
  const opened = await harness.actions.openProjectViaDialog();
  if (!opened.ok) throw new Error(`open failed: ${opened.error.kind}`);
  harness.gateway.clearCalls();
  return harness;
}

export const PROJECT_ISSUE: LoadIssue = {
  kind: "unlistedEntity",
  path: "documents/unlisted",
  entityId: null,
  detail: "directory is not in documentOrder",
};

// Makes the next project open report load issues (the fake disk has none of its own).
export async function seedProjectIssues(
  harness: WorkspaceHarness,
  issues: readonly LoadIssue[],
): Promise<void> {
  const snapshot = await harness.gateway.openProject(SELECTION_ID);
  if (!snapshot.ok) throw new Error("fake project must open");
  harness.gateway.overrideProjectSnapshot(SELECTION_ID, {
    ...snapshot.value,
    issues,
  });
}

// Creates a block in sheet A1 and deletes it while the content deletion fails: the
// command succeeds and the session records an `orphanContentFile` warning.
export async function produceOrphanContentWarning(
  harness: WorkspaceHarness,
  documentId: DocumentId = DOCUMENT_A,
  sheetId: SheetId = SHEET_A1,
): Promise<void> {
  const session = harness.workspace.getDocumentSession(documentId);
  if (session === null) throw new Error("the document must be open");
  const blockId = blockIdOf(900);
  const created = await session.execute(
    createBlocksCommand(sheetId, [
      {
        blockId,
        blockType: "markdown",
        position: position(0, 0),
        size: size(100, 50),
        text: "body",
      },
    ]),
  );
  if (!created.ok) throw new Error("block creation must succeed");
  harness.gateway.failOn("deleteBlockContent", "ioError");
  const deleted = await session.execute(
    deleteBlocksCommand(sheetId, [blockId]),
  );
  if (!deleted.ok) throw new Error("block deletion must succeed");
}

// An unsaved metadata edit (renames sheet A1), the cheapest way to make a document dirty.
export async function makeDocumentADirty(
  harness: WorkspaceHarness,
  name = "Renamed",
): Promise<void> {
  const session = harness.workspace.getDocumentSession(DOCUMENT_A);
  if (session === null) throw new Error("document A must be open");
  const result = await session.execute(
    renameSheetCommand(SHEET_A1, displayName(name)),
  );
  if (!result.ok) throw new Error("rename must succeed");
}

// Puts blocks (and their content files) on the fake disk, so the next open of the
// document loads a sheet that already has them. Call before the document is opened.
export function seedSheetBlocks(
  harness: WorkspaceHarness,
  documentId: DocumentId,
  sheetId: SheetId,
  blocks: readonly Block[],
): void {
  const stored = harness.gateway.disk.documents.get(documentId);
  const entry = stored?.sheets.get(sheetId);
  if (stored === undefined || entry === undefined) {
    throw new Error("the sheet must be seeded on the fake disk first");
  }
  // The sheet keeps its name: sheet tabs follow the name in the session state.
  stored.sheets.set(sheetId, {
    ...entry,
    sheet: unwrap(
      parseSheet({
        schemaVersion: 1,
        sheetId,
        name: entry.name ?? "Sheet",
        blocks,
      }),
    ),
  });
  for (const [path, text] of Object.entries(filesForBlocks(blocks))) {
    harness.gateway.files.set(path, text);
  }
}
