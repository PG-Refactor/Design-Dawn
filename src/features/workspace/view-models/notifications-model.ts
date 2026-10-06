// View model of the notifications: one flat, prioritised list built from state the
// application layer already holds (save errors, load results, warnings) plus the theme
// and operation errors. Nothing is stored here; the order follows docs/ui-design.md
// §12.5: save errors > load failures > load warnings > orphan content files.

import type { OperationError } from "../../../application/ports/operation-error";
import type {
  EntityState,
  LoadIssue,
} from "../../../application/ports/persistence-types";
import type { AutoSaveState } from "../../../application/settings/auto-save-controller";
import type { LayoutSettingsState } from "../../../application/settings/layout-settings-controller";
import type {
  ApplicationState,
  DocumentSessionState,
} from "../../../application/state/application-state";
import type { ThemeState } from "../../../application/theme/theme-controller";
import type {
  DocumentId,
  FolderId,
  SheetId,
} from "../../../domain/shared/entity-id";
import type { OperationErrorEntry, UiState } from "../ui-state/ui-state";
import {
  describeDocumentLoadStatus,
  describeErrorKind,
  describeLoadIssueKind,
  describeOperationFailure,
  describeSaveFailure,
  MESSAGES,
} from "../workspace-messages";

export type NotificationKind =
  | "saveError"
  | "operationError"
  | "themeSaveError"
  | "autoSaveSaveError"
  | "projectTreeWidthSaveError"
  | "loadFailed"
  | "loadIssue"
  | "themeLoadIssue"
  | "orphanContentFile"
  | "contentLoadFailed"
  | "imageLoadFailed";

export type NotificationSeverity = "error" | "warning";

// Lower number = shown first. Equal priorities keep the order they were collected in
// (project before documents, documents in tab order).
export const NOTIFICATION_PRIORITY: Record<NotificationKind, number> = {
  saveError: 0,
  operationError: 0,
  themeSaveError: 0,
  autoSaveSaveError: 0,
  projectTreeWidthSaveError: 0,
  loadFailed: 1,
  loadIssue: 2,
  themeLoadIssue: 2,
  orphanContentFile: 3,
  contentLoadFailed: 3,
  imageLoadFailed: 3,
};

const NOTIFICATION_SEVERITY: Record<NotificationKind, NotificationSeverity> = {
  saveError: "error",
  operationError: "error",
  themeSaveError: "error",
  autoSaveSaveError: "error",
  projectTreeWidthSaveError: "error",
  loadFailed: "error",
  loadIssue: "warning",
  themeLoadIssue: "warning",
  orphanContentFile: "warning",
  contentLoadFailed: "warning",
  imageLoadFailed: "warning",
};

export type NotificationSource =
  | { readonly scope: "project" }
  | {
      readonly scope: "document";
      readonly documentId: DocumentId;
      readonly name: string;
    }
  | { readonly scope: "app" };

export type NotificationRetry =
  | { readonly kind: "document"; readonly documentId: DocumentId }
  | {
      readonly kind: "folder";
      readonly folderId: FolderId;
      // Shown in the retry button's accessible name; null when the name is unknown.
      readonly folderName: string | null;
    }
  | { readonly kind: "project" };

// A load-failed Sheet is not a tab, so the notification is the only place left to delete
// it (Documents and Folders that failed to load stay deletable from the tree).
export interface NotificationSheetDeletion {
  readonly documentId: DocumentId;
  readonly sheetId: SheetId;
}

export interface NotificationDetail {
  readonly label: string;
  readonly value: string;
}

export interface NotificationItem {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly severity: NotificationSeverity;
  readonly priority: number;
  readonly source: NotificationSource;
  readonly message: string;
  readonly details: readonly NotificationDetail[];
  readonly retry: NotificationRetry | null;
  readonly sheetDeletion: NotificationSheetDeletion | null;
  // Set for operation errors, which the user can dismiss.
  readonly dismissId: number | null;
}

export interface NotificationCounts {
  readonly errors: number;
  readonly warnings: number;
  readonly total: number;
}

export interface NotificationsModel {
  readonly items: readonly NotificationItem[];
  readonly counts: NotificationCounts;
}

export interface NotificationsInput {
  readonly application: Pick<
    ApplicationState,
    "project" | "documents" | "documentDetails"
  >;
  readonly operationErrors: readonly OperationErrorEntry[];
  // UI state: image blocks the `<img>` could not load (see `UiState.imageLoadFailures`).
  readonly imageLoadFailures?: UiState["imageLoadFailures"];
  readonly theme: Pick<ThemeState, "loadIssue" | "saveError">;
  // Only its save error is shown: a settings file that could not be read is already
  // reported once through `theme.loadIssue`.
  readonly autoSave?: Pick<AutoSaveState, "saveError">;
  readonly layoutSettings?: Pick<LayoutSettingsState, "saveError">;
}

const NO_IMAGE_LOAD_FAILURES: NonNullable<
  NotificationsInput["imageLoadFailures"]
> = new Map();

const DETAIL_LABELS = MESSAGES.notifications.detailLabels;

function errorDetails(error: OperationError): readonly NotificationDetail[] {
  return [
    { label: DETAIL_LABELS.kind, value: error.kind },
    { label: DETAIL_LABELS.detail, value: error.detail },
  ];
}

function issueDetails(issue: LoadIssue): readonly NotificationDetail[] {
  const details: NotificationDetail[] = [
    { label: DETAIL_LABELS.kind, value: issue.kind },
  ];
  if (issue.path !== null) {
    details.push({ label: DETAIL_LABELS.path, value: issue.path });
  }
  if (issue.entityId !== null) {
    details.push({ label: DETAIL_LABELS.entityId, value: issue.entityId });
  }
  details.push({ label: DETAIL_LABELS.detail, value: issue.detail });
  return details;
}

function makeItem(
  fields: Omit<
    NotificationItem,
    "severity" | "priority" | "retry" | "dismissId" | "sheetDeletion"
  > &
    Partial<Pick<NotificationItem, "retry" | "dismissId" | "sheetDeletion">>,
): NotificationItem {
  return {
    retry: null,
    dismissId: null,
    sheetDeletion: null,
    ...fields,
    severity: NOTIFICATION_SEVERITY[fields.kind],
    priority: NOTIFICATION_PRIORITY[fields.kind],
  };
}

// An `entityLoadFailed` load issue and the loadFailed entity describe the same fact, so
// the issue is folded into the entity's item instead of being counted twice.
function loadFailedItems(
  source: NotificationSource,
  idPrefix: string,
  failedEntityIds: ReadonlyMap<string, string>,
  issues: readonly LoadIssue[],
  sheetDeletionOf?: (entityId: string) => NotificationSheetDeletion,
): readonly NotificationItem[] {
  return [...failedEntityIds].map(([entityId, message]) => {
    const issue = issues.find(
      (candidate) =>
        candidate.kind === "entityLoadFailed" &&
        candidate.entityId === entityId,
    );
    return makeItem({
      id: `${idPrefix}:${entityId}`,
      kind: "loadFailed",
      source,
      message,
      details:
        issue === undefined
          ? [{ label: DETAIL_LABELS.entityId, value: entityId }]
          : issueDetails(issue),
      sheetDeletion: sheetDeletionOf?.(entityId) ?? null,
    });
  });
}

function nonDuplicateIssues(
  issues: readonly LoadIssue[],
  failedEntityIds: ReadonlyMap<string, string>,
): readonly LoadIssue[] {
  return issues.filter(
    (issue) =>
      !(
        issue.kind === "entityLoadFailed" &&
        issue.entityId !== null &&
        failedEntityIds.has(issue.entityId)
      ),
  );
}

function failedIds<Entry extends { readonly state: EntityState }>(
  entries: readonly Entry[],
  idOf: (entry: Entry) => string,
  message: string,
): ReadonlyMap<string, string> {
  return new Map(
    entries
      .filter((entry) => entry.state === "loadFailed")
      .map((entry) => [idOf(entry), message]),
  );
}

function collectProjectItems(
  input: NotificationsInput,
): readonly NotificationItem[] {
  const project = input.application.project;
  if (project === null) return [];
  const source: NotificationSource = { scope: "project" };
  const items: NotificationItem[] = [];
  if (project.save.lastError !== null) {
    items.push(
      makeItem({
        id: "saveError:project",
        kind: "saveError",
        source,
        message: describeSaveFailure(null, project.save.lastError.kind),
        details: errorDetails(project.save.lastError),
        retry: { kind: "project" },
      }),
    );
  }
  for (const folder of project.folders) {
    if (folder.save.lastError === null) continue;
    items.push(
      makeItem({
        id: `saveError:folder:${folder.folderId}`,
        kind: "saveError",
        source,
        message: describeSaveFailure(folder.name, folder.save.lastError.kind),
        details: errorDetails(folder.save.lastError),
        retry: {
          kind: "folder",
          folderId: folder.folderId,
          folderName: folder.name,
        },
      }),
    );
  }
  const failed = failedIds(
    project.documents,
    (entry) => entry.documentId,
    MESSAGES.notifications.loadFailedDocument,
  );
  items.push(
    ...loadFailedItems(source, "loadFailed:document", failed, project.issues),
  );
  nonDuplicateIssues(project.issues, failed).forEach((issue, index) => {
    items.push(
      makeItem({
        id: `loadIssue:project:${index}`,
        kind: "loadIssue",
        source,
        message: describeLoadIssueKind(issue.kind),
        details: issueDetails(issue),
      }),
    );
  });
  return items;
}

// A text block whose file could not be read: shown as an error inside the block, and
// listed here so it is not only visible while that sheet is on screen.
function contentLoadFailedItems(
  documentId: DocumentId,
  source: NotificationSource,
  session: DocumentSessionState,
): readonly NotificationItem[] {
  const contentPaths = new Map(
    [...session.sheets.values()].flatMap((sheet) =>
      sheet.blocks.map((block) => [block.blockId, block.contentPath] as const),
    ),
  );
  return [...session.contentStatus].flatMap(([blockId, loadStatus]) => {
    if (loadStatus.status !== "failed") return [];
    const path = contentPaths.get(blockId);
    return [
      makeItem({
        id: `contentLoadFailed:${documentId}:${blockId}`,
        kind: "contentLoadFailed",
        source,
        message: MESSAGES.notifications.contentLoadFailed,
        details: [
          { label: DETAIL_LABELS.entityId, value: blockId },
          ...(path === undefined
            ? []
            : [{ label: DETAIL_LABELS.path, value: path }]),
          ...errorDetails(loadStatus.error),
        ],
      }),
    ];
  });
}

// An image block whose picture could not be loaded: shown as an error inside the block,
// and listed here so it is not only visible while that sheet is on screen. The block must
// still exist (the failure set is pruned with the blocks, this is the second guard).
function imageLoadFailedItems(
  documentId: DocumentId,
  source: NotificationSource,
  session: DocumentSessionState,
  failures: NonNullable<NotificationsInput["imageLoadFailures"]>,
): readonly NotificationItem[] {
  return [...session.sheets].flatMap(([sheetId, sheet]) => {
    const failed = failures.get(sheetId);
    if (failed === undefined) return [];
    return sheet.blocks
      .filter((block) => failed.has(block.blockId))
      .map((block) =>
        makeItem({
          id: `imageLoadFailed:${documentId}:${block.blockId}`,
          kind: "imageLoadFailed",
          source,
          message: MESSAGES.notifications.imageLoadFailed,
          details: [
            { label: DETAIL_LABELS.entityId, value: block.blockId },
            { label: DETAIL_LABELS.path, value: block.contentPath },
          ],
        }),
      );
  });
}

function collectDocumentItems(
  input: NotificationsInput,
): readonly NotificationItem[] {
  const items: NotificationItem[] = [];
  for (const [documentId, session] of input.application.documents) {
    const source: NotificationSource = {
      scope: "document",
      documentId,
      name: session.document.name,
    };
    const details = input.application.documentDetails.get(documentId);
    if (session.save.lastError !== null) {
      items.push(
        makeItem({
          id: `saveError:document:${documentId}`,
          kind: "saveError",
          source,
          message: describeSaveFailure(
            session.document.name,
            session.save.lastError.kind,
          ),
          details: errorDetails(session.save.lastError),
          retry: { kind: "document", documentId },
        }),
      );
    }
    const issues = details?.issues ?? [];
    const failed = failedIds<{ sheetId: SheetId; state: EntityState }>(
      details?.sheetEntries ?? [],
      (entry) => entry.sheetId,
      MESSAGES.notifications.loadFailedSheet,
    );
    items.push(
      ...loadFailedItems(
        source,
        `loadFailed:sheet:${documentId}`,
        failed,
        issues,
        (entityId) => ({ documentId, sheetId: entityId as SheetId }),
      ),
    );
    nonDuplicateIssues(issues, failed).forEach((issue, index) => {
      items.push(
        makeItem({
          id: `loadIssue:document:${documentId}:${index}`,
          kind: "loadIssue",
          source,
          message: describeLoadIssueKind(issue.kind),
          details: issueDetails(issue),
        }),
      );
    });
    items.push(...contentLoadFailedItems(documentId, source, session));
    items.push(
      ...imageLoadFailedItems(
        documentId,
        source,
        session,
        input.imageLoadFailures ?? NO_IMAGE_LOAD_FAILURES,
      ),
    );
    session.warnings.forEach((warning, index) => {
      items.push(
        makeItem({
          id: `orphanContentFile:${documentId}:${index}`,
          kind: "orphanContentFile",
          source,
          message: MESSAGES.notifications.orphanContentFile,
          details: [
            { label: DETAIL_LABELS.path, value: warning.contentPath },
            ...errorDetails(warning.error),
          ],
        }),
      );
    });
  }
  return items;
}

function collectAppItems(
  input: NotificationsInput,
): readonly NotificationItem[] {
  const source: NotificationSource = { scope: "app" };
  const items: NotificationItem[] = input.operationErrors.map((entry) =>
    makeItem({
      id: `operationError:${entry.id}`,
      kind: "operationError",
      source,
      message: describeOperationFailure(
        entry.operation,
        entry.subject,
        entry.error.kind,
      ),
      details: errorDetails(entry.error),
      dismissId: entry.id,
    }),
  );
  const { saveError, loadIssue } = input.theme;
  if (saveError !== null) {
    items.push(
      makeItem({
        id: "themeSaveError",
        kind: "themeSaveError",
        source,
        message: `${MESSAGES.notifications.themeSaveError} ${describeErrorKind(saveError.kind)}`,
        details: errorDetails(saveError),
      }),
    );
  }
  const autoSaveError = input.autoSave?.saveError ?? null;
  if (autoSaveError !== null) {
    items.push(
      makeItem({
        id: "autoSaveSaveError",
        kind: "autoSaveSaveError",
        source,
        message: `${MESSAGES.notifications.autoSaveSaveError} ${describeErrorKind(autoSaveError.kind)}`,
        details: errorDetails(autoSaveError),
      }),
    );
  }
  const layoutError = input.layoutSettings?.saveError ?? null;
  if (layoutError !== null) {
    items.push(
      makeItem({
        id: "projectTreeWidthSaveError",
        kind: "projectTreeWidthSaveError",
        source,
        message: `${MESSAGES.notifications.projectTreeWidthSaveError} ${describeErrorKind(layoutError.kind)}`,
        details: errorDetails(layoutError),
      }),
    );
  }
  if (loadIssue !== null) {
    items.push(
      makeItem({
        id: "themeLoadIssue",
        kind: "themeLoadIssue",
        source,
        message: MESSAGES.notifications.themeLoadIssue,
        details: errorDetails(loadIssue),
      }),
    );
  }
  return items;
}

export function countNotifications(
  items: readonly NotificationItem[],
): NotificationCounts {
  const errors = items.filter((item) => item.severity === "error").length;
  return { errors, warnings: items.length - errors, total: items.length };
}

export function selectNotifications(
  input: NotificationsInput,
): NotificationsModel {
  const collected = [
    ...collectProjectItems(input),
    ...collectDocumentItems(input),
    ...collectAppItems(input),
  ];
  // Array.prototype.sort is stable, so equal priorities keep the collection order.
  const items = [...collected].sort(
    (first, second) => first.priority - second.priority,
  );
  return { items, counts: countNotifications(items) };
}

// Messages for the polite live region: one per project / document that was loaded with
// warnings. Load issues never go away while the entity stays open, so this is derived
// state, not an event log.
export function selectLoadStatusMessages(
  application: Pick<
    ApplicationState,
    "project" | "documents" | "documentDetails"
  >,
): readonly string[] {
  const messages: string[] = [];
  const project = application.project;
  if (project !== null && project.issues.length > 0) {
    messages.push(MESSAGES.notifications.projectLoadedWithWarnings);
  }
  for (const [documentId, session] of application.documents) {
    const issues = application.documentDetails.get(documentId)?.issues ?? [];
    if (issues.length > 0) {
      messages.push(describeDocumentLoadStatus(session.document.name));
    }
  }
  return messages;
}
