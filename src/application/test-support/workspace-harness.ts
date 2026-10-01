// A workspace wired to the fakes, with a seeded fake disk and every emitted event
// collected. Documents A and B load fine; FAILED_DOCUMENT_ID's own metadata is broken.

import type { OperationResult } from "../ports/operation-error";
import type { LoadIssue } from "../ports/persistence-types";
import {
  type ApplicationStore,
  createApplicationStore,
} from "../state/application-state";
import { createWorkspace, type Workspace } from "../workspace/workspace";
import type { WorkspaceEvent } from "../workspace/workspace-events";
import {
  createFakeGateway,
  createFakeScheduler,
  createSequentialIdGenerator,
  documentIdOf,
  type FakeGateway,
  type FakeScheduler,
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
  const workspace = createWorkspace({
    gateway,
    scheduler,
    idGenerator: createSequentialIdGenerator(),
    store,
    config: { undoHistoryLimit: 50, autoSaveDelayMs: TEST_AUTO_SAVE_DELAY_MS },
  });
  workspace.subscribe((event) => events.push(event));
  return { workspace, gateway, scheduler, store, events };
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
