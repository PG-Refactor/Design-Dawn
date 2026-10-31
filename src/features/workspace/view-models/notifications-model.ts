// View model of the notifications: one flat, prioritised list built from state the
// application layer already holds (save errors, load results, warnings) plus the theme
// and operation errors. Nothing is stored here; the order is: save errors > load failures > load warnings > orphan content files.

import type { LanguageState } from "../../../application/language/language-controller";
import type { RepairTarget } from "../../../application/load-issue-repair/load-issue-repair-controller";
import {
  RELOAD_ONLY_ISSUE_KINDS,
  REPAIR_ACTIONS_BY_ISSUE_KIND,
} from "../../../application/load-issue-repair/repair-catalog";
import type { OperationError } from "../../../application/ports/operation-error";
import type {
  EntityState,
  LoadIssue,
  LoadIssueRef,
  RepairAction,
} from "../../../application/ports/persistence-types";
import type { AutoSaveState } from "../../../application/settings/auto-save-controller";
import type { LayoutSettingsState } from "../../../application/settings/layout-settings-controller";
import type { TextSizeState } from "../../../application/settings/text-size-controller";
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
  type WorkspaceMessages,
} from "../workspace-messages";

export type NotificationKind =
  | "saveError"
  | "operationError"
  | "themeSaveError"
  | "languageSaveError"
  | "textSizeSaveError"
  | "autoSaveSaveError"
  | "projectTreeWidthSaveError"
  | "loadFailed"
  | "loadIssue"
  | "formatUpdate"
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
  languageSaveError: 0,
  textSizeSaveError: 0,
  autoSaveSaveError: 0,
  projectTreeWidthSaveError: 0,
  loadFailed: 1,
  loadIssue: 2,
  themeLoadIssue: 2,
  formatUpdate: 4,
  orphanContentFile: 3,
  contentLoadFailed: 3,
  imageLoadFailed: 3,
};

const NOTIFICATION_SEVERITY: Record<NotificationKind, NotificationSeverity> = {
  saveError: "error",
  operationError: "error",
  themeSaveError: "error",
  languageSaveError: "error",
  textSizeSaveError: "error",
  autoSaveSaveError: "error",
  projectTreeWidthSaveError: "error",
  loadFailed: "error",
  loadIssue: "warning",
  formatUpdate: "warning",
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

// The explicit repairs offered for a Load Issue: which issue
// to name, which Document reported it, and the actions that apply to its kind.
export interface NotificationRepair {
  readonly target: RepairTarget;
  readonly issue: LoadIssueRef;
  readonly actions: readonly RepairAction[];
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
  readonly repair: NotificationRepair | null;
  // Set when the files can be read again from disk (an issue with no automatic repair).
  readonly reload: RepairTarget | null;
  // Set on the one notice that lists the files in an older format ("update all now").
  readonly formatUpdate: boolean;
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
  // The texts are produced here, so the model is recomputed when the language changes.
  readonly messages: WorkspaceMessages;
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
  readonly language?: Pick<LanguageState, "saveError">;
  readonly textSize?: Pick<TextSizeState, "saveError">;
  readonly layoutSettings?: Pick<LayoutSettingsState, "saveError">;
}

const NO_IMAGE_LOAD_FAILURES: NonNullable<
  NotificationsInput["imageLoadFailures"]
> = new Map();

type DetailLabels = WorkspaceMessages["notifications"]["detailLabels"];

function errorDetails(
  labels: DetailLabels,
  error: OperationError,
): readonly NotificationDetail[] {
  return [
    { label: labels.kind, value: error.kind },
    { label: labels.detail, value: error.detail },
  ];
}

function issueDetails(
  labels: DetailLabels,
  issue: LoadIssue,
): readonly NotificationDetail[] {
  const details: NotificationDetail[] = [
    { label: labels.kind, value: issue.kind },
  ];
  if (issue.reason !== null) {
    details.push({ label: labels.reason, value: issue.reason });
  }
  if (issue.path !== null) {
    details.push({ label: labels.path, value: issue.path });
  }
  if (issue.entityId !== null) {
    details.push({ label: labels.entityId, value: issue.entityId });
  }
  details.push({ label: labels.detail, value: issue.detail });
  return details;
}

function makeItem(
  fields: Omit<
    NotificationItem,
    | "severity"
    | "priority"
    | "retry"
    | "dismissId"
    | "sheetDeletion"
    | "repair"
    | "reload"
    | "formatUpdate"
  > &
    Partial<
      Pick<
        NotificationItem,
        | "retry"
        | "dismissId"
        | "sheetDeletion"
        | "repair"
        | "reload"
        | "formatUpdate"
      >
    >,
): NotificationItem {
  return {
    retry: null,
    dismissId: null,
    sheetDeletion: null,
    repair: null,
    reload: null,
    formatUpdate: false,
    ...fields,
    severity: NOTIFICATION_SEVERITY[fields.kind],
    priority: NOTIFICATION_PRIORITY[fields.kind],
  };
}

// An `entityLoadFailed` load issue and the loadFailed entity describe the same fact, so
// the issue is folded into the entity's item instead of being counted twice.
const UNSUPPORTED_VERSION_REASON = "unsupportedSchemaVersion";

function loadFailedItems(
  messages: WorkspaceMessages,
  source: NotificationSource,
  target: RepairTarget,
  idPrefix: string,
  failedEntityIds: ReadonlyMap<string, string>,
  issues: readonly LoadIssue[],
  sheetDeletionOf?: (entityId: string) => NotificationSheetDeletion,
): readonly NotificationItem[] {
  const labels = messages.notifications.detailLabels;
  return [...failedEntityIds].map(([entityId, message]) => {
    const issue = issues.find(
      (candidate) =>
        candidate.kind === "entityLoadFailed" &&
        candidate.entityId === entityId,
    );
    // A newer file format is read-only for good: the reason is stated, and reading the
    // files again would not change anything.
    const readOnly = issue?.reason === UNSUPPORTED_VERSION_REASON;
    return makeItem({
      id: `${idPrefix}:${entityId}`,
      kind: "loadFailed",
      source,
      message: readOnly
        ? `${message} ${messages.notifications.readOnlyHint}`
        : message,
      reload: readOnly ? null : target,
      details:
        issue === undefined
          ? [{ label: labels.entityId, value: entityId }]
          : issueDetails(labels, issue),
      sheetDeletion: sheetDeletionOf?.(entityId) ?? null,
    });
  });
}

// The issues listed one by one: not the ones folded into a failed entity's item, and not
// the older-format files, which are listed together in one notice.
function nonDuplicateIssues(
  issues: readonly LoadIssue[],
  failedEntityIds: ReadonlyMap<string, string>,
): readonly LoadIssue[] {
  return issues.filter(
    (issue) =>
      issue.kind !== "outdatedFormat" &&
      !(
        issue.kind === "entityLoadFailed" &&
        issue.entityId !== null &&
        failedEntityIds.has(issue.entityId)
      ),
  );
}

// The repairs and the "read again" the notification of one issue offers.
function repairOptionsOf(
  messages: WorkspaceMessages,
  issue: LoadIssue,
  target: RepairTarget,
): Pick<NotificationItem, "repair" | "reload" | "message"> {
  const actions = REPAIR_ACTIONS_BY_ISSUE_KIND[issue.kind];
  const readOnly = issue.reason === UNSUPPORTED_VERSION_REASON;
  const base = describeLoadIssueKind(messages, issue.kind);
  return {
    message: readOnly ? `${base} ${messages.notifications.readOnlyHint}` : base,
    repair:
      actions.length === 0
        ? null
        : {
            target,
            issue: {
              kind: issue.kind,
              path: issue.path,
              entityId: issue.entityId,
            },
            actions,
          },
    reload:
      RELOAD_ONLY_ISSUE_KINDS.includes(issue.kind) && !readOnly ? target : null,
  };
}

// One notice for every file the loader read in an older format, with the "update all now"
// action. Nothing is rewritten until the user asks or the file is saved.
function formatUpdateItem(
  messages: WorkspaceMessages,
  issues: readonly LoadIssue[],
): readonly NotificationItem[] {
  const files = issues
    .filter((issue) => issue.kind === "outdatedFormat" && issue.path !== null)
    .map((issue) => issue.path as string);
  if (files.length === 0) return [];
  const labels = messages.notifications.detailLabels;
  return [
    makeItem({
      id: "formatUpdate",
      kind: "formatUpdate",
      source: { scope: "project" },
      message: messages.notifications.formatUpdate,
      details: files.map((path) => ({ label: labels.path, value: path })),
      formatUpdate: true,
    }),
  ];
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
  const { messages } = input;
  const labels = messages.notifications.detailLabels;
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
        message: describeSaveFailure(
          messages,
          null,
          project.save.lastError.kind,
        ),
        details: errorDetails(labels, project.save.lastError),
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
        message: describeSaveFailure(
          messages,
          folder.name,
          folder.save.lastError.kind,
        ),
        details: errorDetails(labels, folder.save.lastError),
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
    messages.notifications.loadFailedDocument,
  );
  const projectTarget: RepairTarget = { scope: "project" };
  items.push(
    ...loadFailedItems(
      messages,
      source,
      projectTarget,
      "loadFailed:document",
      failed,
      project.issues,
    ),
  );
  nonDuplicateIssues(project.issues, failed).forEach((issue, index) => {
    items.push(
      makeItem({
        id: `loadIssue:project:${index}`,
        kind: "loadIssue",
        source,
        details: issueDetails(labels, issue),
        ...repairOptionsOf(messages, issue, projectTarget),
      }),
    );
  });
  return items;
}

// A text block whose file could not be read: shown as an error inside the block, and
// listed here so it is not only visible while that sheet is on screen.
function contentLoadFailedItems(
  messages: WorkspaceMessages,
  documentId: DocumentId,
  source: NotificationSource,
  session: DocumentSessionState,
): readonly NotificationItem[] {
  const labels = messages.notifications.detailLabels;
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
        message: messages.notifications.contentLoadFailed,
        details: [
          { label: labels.entityId, value: blockId },
          ...(path === undefined ? [] : [{ label: labels.path, value: path }]),
          ...errorDetails(labels, loadStatus.error),
        ],
      }),
    ];
  });
}

// An image block whose picture could not be loaded: shown as an error inside the block,
// and listed here so it is not only visible while that sheet is on screen. The block must
// still exist (the failure set is pruned with the blocks, this is the second guard).
function imageLoadFailedItems(
  messages: WorkspaceMessages,
  documentId: DocumentId,
  source: NotificationSource,
  session: DocumentSessionState,
  failures: NonNullable<NotificationsInput["imageLoadFailures"]>,
): readonly NotificationItem[] {
  const labels = messages.notifications.detailLabels;
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
          message: messages.notifications.imageLoadFailed,
          details: [
            { label: labels.entityId, value: block.blockId },
            { label: labels.path, value: block.contentPath },
          ],
        }),
      );
  });
}

function collectDocumentItems(
  input: NotificationsInput,
): readonly NotificationItem[] {
  const { messages } = input;
  const labels = messages.notifications.detailLabels;
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
            messages,
            session.document.name,
            session.save.lastError.kind,
          ),
          details: errorDetails(labels, session.save.lastError),
          retry: { kind: "document", documentId },
        }),
      );
    }
    const issues = details?.issues ?? [];
    const failed = failedIds<{ sheetId: SheetId; state: EntityState }>(
      details?.sheetEntries ?? [],
      (entry) => entry.sheetId,
      messages.notifications.loadFailedSheet,
    );
    const documentTarget: RepairTarget = { scope: "document", documentId };
    items.push(
      ...loadFailedItems(
        messages,
        source,
        documentTarget,
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
          details: issueDetails(labels, issue),
          ...repairOptionsOf(messages, issue, documentTarget),
        }),
      );
    });
    items.push(
      ...contentLoadFailedItems(messages, documentId, source, session),
    );
    items.push(
      ...imageLoadFailedItems(
        messages,
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
          message: messages.notifications.orphanContentFile,
          details: [
            { label: labels.path, value: warning.contentPath },
            ...errorDetails(labels, warning.error),
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
  const { messages } = input;
  const labels = messages.notifications.detailLabels;
  const source: NotificationSource = { scope: "app" };
  const items: NotificationItem[] = input.operationErrors.map((entry) =>
    makeItem({
      id: `operationError:${entry.id}`,
      kind: "operationError",
      source,
      message: describeOperationFailure(
        messages,
        entry.operation,
        entry.subject,
        entry.error.kind,
      ),
      details: errorDetails(labels, entry.error),
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
        message: `${messages.notifications.themeSaveError} ${describeErrorKind(messages, saveError.kind)}`,
        details: errorDetails(labels, saveError),
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
        message: `${messages.notifications.autoSaveSaveError} ${describeErrorKind(messages, autoSaveError.kind)}`,
        details: errorDetails(labels, autoSaveError),
      }),
    );
  }
  const languageError = input.language?.saveError ?? null;
  if (languageError !== null) {
    items.push(
      makeItem({
        id: "languageSaveError",
        kind: "languageSaveError",
        source,
        message: `${messages.notifications.languageSaveError} ${describeErrorKind(messages, languageError.kind)}`,
        details: errorDetails(labels, languageError),
      }),
    );
  }
  const textSizeError = input.textSize?.saveError ?? null;
  if (textSizeError !== null) {
    items.push(
      makeItem({
        id: "textSizeSaveError",
        kind: "textSizeSaveError",
        source,
        message: `${messages.notifications.textSizeSaveError} ${describeErrorKind(messages, textSizeError.kind)}`,
        details: errorDetails(labels, textSizeError),
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
        message: `${messages.notifications.projectTreeWidthSaveError} ${describeErrorKind(messages, layoutError.kind)}`,
        details: errorDetails(labels, layoutError),
      }),
    );
  }
  if (loadIssue !== null) {
    items.push(
      makeItem({
        id: "themeLoadIssue",
        kind: "themeLoadIssue",
        source,
        message: messages.notifications.themeLoadIssue,
        details: errorDetails(labels, loadIssue),
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
  const allIssues = [
    ...(input.application.project?.issues ?? []),
    ...[...input.application.documentDetails.values()].flatMap(
      (details) => details.issues,
    ),
  ];
  const collected = [
    ...collectProjectItems(input),
    ...collectDocumentItems(input),
    ...formatUpdateItem(input.messages, allIssues),
    ...collectAppItems(input),
  ];
  // Array.prototype.sort is stable, so equal priorities keep the collection order.
  const items = [...collected].sort(
    (first, second) => first.priority - second.priority,
  );
  return { items, counts: countNotifications(items) };
}

// The older-format notice is a hint, not a warning that the load went wrong.
function isReportedAsWarning(issue: LoadIssue): boolean {
  return issue.kind !== "outdatedFormat";
}

// Messages for the polite live region: one per project / document that was loaded with
// warnings. Load issues never go away while the entity stays open, so this is derived
// state, not an event log.
export function selectLoadStatusMessages(
  messages: WorkspaceMessages,
  application: Pick<
    ApplicationState,
    "project" | "documents" | "documentDetails"
  >,
): readonly string[] {
  const texts: string[] = [];
  const project = application.project;
  if (project?.issues.some(isReportedAsWarning)) {
    texts.push(messages.notifications.projectLoadedWithWarnings);
  }
  for (const [documentId, session] of application.documents) {
    const issues = application.documentDetails.get(documentId)?.issues ?? [];
    if (issues.some(isReportedAsWarning)) {
      texts.push(describeDocumentLoadStatus(messages, session.document.name));
    }
  }
  return texts;
}
