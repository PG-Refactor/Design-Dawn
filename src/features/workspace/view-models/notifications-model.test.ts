import { describe, expect, it } from "vitest";
import type { OperationError } from "../../../application/ports/operation-error";
import { createApplicationStore } from "../../../application/state/application-state";
import { settle } from "../../../application/test-support/fakes";
import {
  createWorkspaceHarness,
  DOCUMENT_A,
  DOCUMENT_A_ISSUE,
  DOCUMENT_B,
  FAILED_DOCUMENT_ID,
  FAILED_SHEET_ID,
  SELECTION_ID,
  SHEET_B1,
} from "../../../application/test-support/workspace-harness";
import {
  makeDocumentADirty,
  PROJECT_ISSUE,
  produceOrphanContentWarning,
  seedProjectIssues,
} from "../test-support/actions-harness";
import type { OperationErrorEntry } from "../ui-state/ui-state";
import {
  countNotifications,
  type NotificationItem,
  selectLoadStatusMessages,
  selectNotifications,
} from "./notifications-model";

const NO_THEME_PROBLEMS = { loadIssue: null, saveError: null } as const;
const IO_ERROR: OperationError = { kind: "ioError", detail: "disk is gone" };

async function richWorkspace() {
  const harness = createWorkspaceHarness();
  await seedProjectIssues(harness, [PROJECT_ISSUE]);
  await harness.workspace.openProject(SELECTION_ID);
  await harness.workspace.openDocument(DOCUMENT_A);
  await harness.workspace.openDocument(DOCUMENT_B);
  return harness;
}

const kindsOf = (items: readonly NotificationItem[]) =>
  items.map((item) => item.kind);

describe("selectNotifications", () => {
  it("is empty without a project and without problems", () => {
    const model = selectNotifications({
      application: createApplicationStore().getState(),
      operationErrors: [],
      theme: NO_THEME_PROBLEMS,
    });
    expect(model.items).toEqual([]);
    expect(model.counts).toEqual({ errors: 0, warnings: 0, total: 0 });
  });

  it("lists every load issue and the load failures, nothing else, for a fresh load", async () => {
    const harness = await richWorkspace();
    const model = selectNotifications({
      application: harness.store.getState(),
      operationErrors: [],
      theme: NO_THEME_PROBLEMS,
    });
    // failed document, failed sheet (errors first), then project and document warnings.
    expect(model.items.map((item) => item.id)).toEqual([
      `loadFailed:document:${FAILED_DOCUMENT_ID}`,
      `loadFailed:sheet:${DOCUMENT_A}:${FAILED_SHEET_ID}`,
      "loadIssue:project:0",
      `loadIssue:document:${DOCUMENT_A}:0`,
    ]);
    expect(model.counts).toEqual({ errors: 2, warnings: 2, total: 4 });
    const documentIssue = model.items[3];
    expect(documentIssue?.source).toEqual({
      scope: "document",
      documentId: DOCUMENT_A,
      name: "Document A",
    });
    expect(documentIssue?.details).toContainEqual({
      label: "パス",
      value: DOCUMENT_A_ISSUE.path,
    });
  });

  it("orders save errors before load failures before load warnings before orphan files", async () => {
    const harness = await richWorkspace();
    await produceOrphanContentWarning(harness, DOCUMENT_B, SHEET_B1);
    await makeDocumentADirty(harness);
    harness.gateway.failAlways("saveSheet", "ioError");
    await harness.workspace.getDocumentSession(DOCUMENT_A)?.flush();
    await settle();
    const operationErrors: OperationErrorEntry[] = [
      { id: 1, operation: "openProject", subject: null, error: IO_ERROR },
    ];
    const model = selectNotifications({
      application: harness.store.getState(),
      operationErrors,
      theme: { loadIssue: IO_ERROR, saveError: IO_ERROR },
    });
    const priorities = model.items.map((item) => item.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
    expect(kindsOf(model.items)).toEqual([
      "saveError",
      "operationError",
      "themeSaveError",
      "loadFailed",
      "loadFailed",
      "loadIssue",
      "loadIssue",
      "themeLoadIssue",
      "orphanContentFile",
    ]);
    const save = model.items[0];
    expect(save?.retry).toEqual({ kind: "document", documentId: DOCUMENT_A });
    expect(save?.severity).toBe("error");
    expect(model.items.at(-1)?.severity).toBe("warning");
  });

  it("offers a project save retry and dismissal for operation errors", async () => {
    const harness = await richWorkspace();
    harness.gateway.failAlways("saveProject", "ioError");
    await harness.workspace.createDocument("New");
    const model = selectNotifications({
      application: harness.store.getState(),
      operationErrors: [
        { id: 7, operation: "deleteSheet", subject: "S", error: IO_ERROR },
      ],
      theme: NO_THEME_PROBLEMS,
    });
    const projectSave = model.items.find((item) => item.kind === "saveError");
    expect(projectSave?.retry).toEqual({ kind: "project" });
    expect(projectSave?.source).toEqual({ scope: "project" });
    const operation = model.items.find(
      (item) => item.kind === "operationError",
    );
    expect(operation?.dismissId).toBe(7);
    expect(operation?.message).toContain("「S」");
    expect(operation?.details).toEqual([
      { label: "種別", value: "ioError" },
      { label: "詳細", value: "disk is gone" },
    ]);
  });

  it("does not count an entityLoadFailed issue twice for a failed entity", async () => {
    const harness = createWorkspaceHarness();
    await seedProjectIssues(harness, [
      {
        kind: "entityLoadFailed",
        path: "documents/failed/document.json",
        entityId: FAILED_DOCUMENT_ID,
        detail: "bad json",
      },
    ]);
    await harness.workspace.openProject(SELECTION_ID);
    const model = selectNotifications({
      application: harness.store.getState(),
      operationErrors: [],
      theme: NO_THEME_PROBLEMS,
    });
    expect(model.items).toHaveLength(1);
    expect(model.items[0]?.kind).toBe("loadFailed");
    expect(model.items[0]?.details).toContainEqual({
      label: "詳細",
      value: "bad json",
    });
  });
});

describe("countNotifications", () => {
  it("counts errors and warnings separately", () => {
    const item = (severity: "error" | "warning") =>
      ({ severity }) as NotificationItem;
    expect(
      countNotifications([item("error"), item("warning"), item("warning")]),
    ).toEqual({ errors: 1, warnings: 2, total: 3 });
  });
});

describe("selectLoadStatusMessages", () => {
  it("reports the project and each open document loaded with warnings", async () => {
    const harness = createWorkspaceHarness();
    await seedProjectIssues(harness, [PROJECT_ISSUE]);
    await harness.workspace.openProject(SELECTION_ID);
    expect(selectLoadStatusMessages(harness.store.getState())).toEqual([
      "Projectを警告付きで読み込みました",
    ]);
    await harness.workspace.openDocument(DOCUMENT_A);
    await harness.workspace.openDocument(DOCUMENT_B);
    expect(selectLoadStatusMessages(harness.store.getState())).toEqual([
      "Projectを警告付きで読み込みました",
      "Documentを警告付きで読み込みました（Document A）",
    ]);
  });
});
