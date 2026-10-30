import { useEffect, useId, useMemo } from "react";
import { LAYOUT_CONFIG } from "../../config/layout-config";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { clearNotice } from "./ui-state/shell-ui-state";
import type { UiState } from "./ui-state/ui-state";
import { useMessages } from "./use-messages";
import {
  type NotificationItem,
  type NotificationRetry,
  type NotificationSource,
  selectLoadStatusMessages,
  selectNotifications,
} from "./view-models/notifications-model";
import type { WorkspaceActions } from "./workspace-actions";
import { useUiState } from "./workspace-hooks";
import type { WorkspaceMessages } from "./workspace-messages";
import { useWorkspaceServices } from "./workspace-services-context";
import "./notifications.css";

const SEVERITY_ICON = { error: "✖", warning: "⚠" } as const;

const identity = <Value,>(value: Value): Value => value;
const selectOperationErrors = (ui: UiState) => ui.operationErrors;
const selectImageLoadFailures = (ui: UiState) => ui.imageLoadFailures;
const selectNotificationsOpen = (ui: UiState) => ui.notificationsOpen;

function sourceLabel(
  messages: WorkspaceMessages,
  source: NotificationSource,
): string {
  switch (source.scope) {
    case "project":
      return messages.notifications.projectSource;
    case "document":
      return messages.documentSourceLabel(source.name);
    case "app":
      return messages.notifications.appSource;
  }
}

function retryTargetName(
  messages: WorkspaceMessages,
  item: NotificationItem,
): string {
  if (item.source.scope === "document") return item.source.name;
  return item.retry?.kind === "folder"
    ? (item.retry.folderName ?? messages.tree.unnamedEntity)
    : messages.notifications.projectSource;
}

function runRetry(
  actions: WorkspaceActions,
  retry: NotificationRetry,
): Promise<unknown> {
  switch (retry.kind) {
    case "project":
      return actions.retryProjectSave();
    case "folder":
      return actions.retryFolderSave(retry.folderId);
    case "document":
      return actions.retryDocumentSave(retry.documentId);
  }
}

function NotificationEntry({ item }: { readonly item: NotificationItem }) {
  const messages = useMessages().workspace;
  const { actions, loadIssueRepairController } = useWorkspaceServices();
  const severityLabel =
    item.severity === "error"
      ? messages.notifications.errorSeverity
      : messages.notifications.warningSeverity;
  const { retry, dismissId, sheetDeletion, repair, reload, formatUpdate } =
    item;
  const repairTexts = messages.loadIssueRepair;
  return (
    <li className={`notification notification--${item.severity}`}>
      <div className="notification__head">
        <span className="notification__severity">
          <span aria-hidden="true">{SEVERITY_ICON[item.severity]}</span>
          {severityLabel}
        </span>
        <span className="notification__source">
          {sourceLabel(messages, item.source)}
        </span>
      </div>
      <p className="notification__message">{item.message}</p>
      <details className="notification__details">
        <summary>{messages.notifications.details}</summary>
        <dl className="notification__detail-list">
          {item.details.map((detail) => (
            <div key={`${detail.label}:${detail.value}`}>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
        </dl>
      </details>
      <div className="notification__actions">
        {retry === null ? null : (
          <button
            type="button"
            className="button"
            aria-label={messages.retrySaveLabel(
              retryTargetName(messages, item),
            )}
            onClick={() => void runRetry(actions, retry)}
          >
            {messages.notifications.retry}
          </button>
        )}
        {sheetDeletion === null ? null : (
          <button
            type="button"
            className="button"
            onClick={() =>
              actions.requestDeleteSheet(
                sheetDeletion.documentId,
                sheetDeletion.sheetId,
              )
            }
          >
            {messages.notifications.deleteSheet}
          </button>
        )}
        {repair?.actions.map((action) => (
          <button
            key={action}
            type="button"
            className="button"
            onClick={() =>
              void loadIssueRepairController.request(
                repair.target,
                repair.issue,
                action,
              )
            }
          >
            {repairTexts.actions[action]}
          </button>
        ))}
        {reload === null ? null : (
          <button
            type="button"
            className="button"
            onClick={() => loadIssueRepairController.requestReload(reload)}
          >
            {repairTexts.reload}
          </button>
        )}
        {formatUpdate ? (
          <button
            type="button"
            className="button"
            onClick={() =>
              loadIssueRepairController.requestFormatUpdate(
                item.details.map((detail) => detail.value),
              )
            }
          >
            {repairTexts.updateFormat}
          </button>
        ) : null}
        {dismissId === null ? null : (
          <button
            type="button"
            className="button"
            onClick={() => actions.dismissOperationError(dismissId)}
          >
            {messages.notifications.dismiss}
          </button>
        )}
      </div>
    </li>
  );
}

// Summary control plus the non-modal panel it toggles. Nothing here blocks the rest of
// the UI: the panel is an ordinary region, not a dialog.
export function Notifications() {
  const messages = useMessages().workspace;
  const {
    applicationStore,
    themeController,
    languageController,
    autoSaveController,
    layoutSettingsController,
    actions,
  } = useWorkspaceServices();
  const application = useStoreSelector(applicationStore, identity);
  const operationErrors = useUiState(selectOperationErrors);
  const imageLoadFailures = useUiState(selectImageLoadFailures);
  const open = useUiState(selectNotificationsOpen);
  const theme = useStoreSelector(themeController.store, identity);
  const language = useStoreSelector(languageController.store, identity);
  const autoSave = useStoreSelector(autoSaveController.store, identity);
  const layoutSettings = useStoreSelector(
    layoutSettingsController.store,
    identity,
  );
  const panelId = useId();
  const model = useMemo(
    () =>
      selectNotifications({
        messages,
        application,
        operationErrors,
        imageLoadFailures,
        theme,
        language,
        autoSave,
        layoutSettings,
      }),
    [
      messages,
      application,
      operationErrors,
      imageLoadFailures,
      theme,
      language,
      autoSave,
      layoutSettings,
    ],
  );
  const { counts } = model;
  return (
    <div className="notifications">
      <button
        type="button"
        className={`button notifications__summary${counts.errors > 0 ? " notifications__summary--error" : ""}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => actions.setNotificationsOpen(!open)}
      >
        {messages.notificationCounts(counts.errors, counts.warnings)}
      </button>
      {open ? (
        <section
          id={panelId}
          className="notifications__panel"
          aria-label={messages.notifications.panelLabel}
        >
          {model.items.length === 0 ? (
            <p className="notifications__empty">
              {messages.notifications.emptyPanel}
            </p>
          ) : (
            <ul className="notifications__list">
              {model.items.map((item) => (
                <NotificationEntry key={item.id} item={item} />
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

// A polite live region: "Project / Document loaded with warnings". The region always
// exists so that messages added later are announced.
export function LoadStatus() {
  const { applicationStore } = useWorkspaceServices();
  const messages = useMessages().workspace;
  const application = useStoreSelector(applicationStore, identity);
  const statusMessages = useMemo(
    () => selectLoadStatusMessages(messages, application),
    [messages, application],
  );
  return (
    <div
      role="status"
      aria-label={messages.notifications.statusLabel}
      className="load-status"
    >
      {statusMessages.map((message) => (
        <p key={message} className="load-status__message">
          <span aria-hidden="true">{SEVERITY_ICON.warning}</span> {message}
        </p>
      ))}
    </div>
  );
}

const selectNotice = (ui: UiState) => ui.notice;

// A light, polite notice ("already open") that clears itself. The region always exists so
// a notice added later is announced; it is not a failure, so it is not in the panel.
export function TransientNotice() {
  const messages = useMessages().workspace;
  const { uiStateStore } = useWorkspaceServices();
  const notice = useUiState(selectNotice);
  const noticeId = notice?.id ?? null;
  useEffect(() => {
    if (noticeId === null) return;
    const timer = setTimeout(
      () => uiStateStore.setState((state) => clearNotice(state, noticeId)),
      LAYOUT_CONFIG.noticeDurationMs,
    );
    return () => clearTimeout(timer);
  }, [noticeId, uiStateStore]);
  return (
    <div
      role="status"
      aria-label={messages.notices.regionLabel}
      className="transient-notice"
    >
      {notice === null ? null : (
        <p className="transient-notice__message">
          {messages.notices[notice.kind]}
        </p>
      )}
    </div>
  );
}
