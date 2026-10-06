import { useId, useMemo } from "react";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import type { UiState } from "./ui-state/ui-state";
import {
  type NotificationItem,
  type NotificationRetry,
  type NotificationSource,
  selectLoadStatusMessages,
  selectNotifications,
} from "./view-models/notifications-model";
import type { WorkspaceActions } from "./workspace-actions";
import { useUiState, useWorkspaceModel } from "./workspace-hooks";
import {
  MESSAGES,
  retrySaveLabel,
  summarizeNotificationCounts,
} from "./workspace-messages";
import { useWorkspaceServices } from "./workspace-services-context";
import "./notifications.css";

const SEVERITY_ICON = { error: "✖", warning: "⚠" } as const;

const identity = <Value,>(value: Value): Value => value;
const selectOperationErrors = (ui: UiState) => ui.operationErrors;
const selectImageLoadFailures = (ui: UiState) => ui.imageLoadFailures;
const selectNotificationsOpen = (ui: UiState) => ui.notificationsOpen;

function sourceLabel(source: NotificationSource): string {
  switch (source.scope) {
    case "project":
      return MESSAGES.notifications.projectSource;
    case "document":
      return `Document: ${source.name}`;
    case "app":
      return MESSAGES.notifications.appSource;
  }
}

function retryTargetName(item: NotificationItem): string {
  if (item.source.scope === "document") return item.source.name;
  return item.retry?.kind === "folder"
    ? (item.retry.folderName ?? MESSAGES.tree.unnamedEntity)
    : MESSAGES.notifications.projectSource;
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
  const { actions } = useWorkspaceServices();
  const severityLabel =
    item.severity === "error"
      ? MESSAGES.notifications.errorSeverity
      : MESSAGES.notifications.warningSeverity;
  const { retry, dismissId } = item;
  return (
    <li className={`notification notification--${item.severity}`}>
      <div className="notification__head">
        <span className="notification__severity">
          <span aria-hidden="true">{SEVERITY_ICON[item.severity]}</span>
          {severityLabel}
        </span>
        <span className="notification__source">{sourceLabel(item.source)}</span>
      </div>
      <p className="notification__message">{item.message}</p>
      <details className="notification__details">
        <summary>{MESSAGES.notifications.details}</summary>
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
            aria-label={retrySaveLabel(retryTargetName(item))}
            onClick={() => void runRetry(actions, retry)}
          >
            {MESSAGES.notifications.retry}
          </button>
        )}
        {dismissId === null ? null : (
          <button
            type="button"
            className="button"
            onClick={() => actions.dismissOperationError(dismissId)}
          >
            {MESSAGES.notifications.dismiss}
          </button>
        )}
      </div>
    </li>
  );
}

// Summary control plus the non-modal panel it toggles. Nothing here blocks the rest of
// the UI: the panel is an ordinary region, not a dialog.
export function Notifications() {
  const {
    applicationStore,
    themeController,
    autoSaveController,
    layoutSettingsController,
    actions,
  } = useWorkspaceServices();
  const application = useStoreSelector(applicationStore, identity);
  const operationErrors = useUiState(selectOperationErrors);
  const imageLoadFailures = useUiState(selectImageLoadFailures);
  const open = useUiState(selectNotificationsOpen);
  const theme = useStoreSelector(themeController.store, identity);
  const autoSave = useStoreSelector(autoSaveController.store, identity);
  const layoutSettings = useStoreSelector(
    layoutSettingsController.store,
    identity,
  );
  const panelId = useId();
  const model = useMemo(
    () =>
      selectNotifications({
        application,
        operationErrors,
        imageLoadFailures,
        theme,
        autoSave,
        layoutSettings,
      }),
    [
      application,
      operationErrors,
      imageLoadFailures,
      theme,
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
        {summarizeNotificationCounts(counts.errors, counts.warnings)}
      </button>
      {open ? (
        <section
          id={panelId}
          className="notifications__panel"
          aria-label={MESSAGES.notifications.panelLabel}
        >
          {model.items.length === 0 ? (
            <p className="notifications__empty">
              {MESSAGES.notifications.emptyPanel}
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
  const messages = useWorkspaceModel(selectLoadStatusMessages);
  return (
    <div
      role="status"
      aria-label={MESSAGES.notifications.statusLabel}
      className="load-status"
    >
      {messages.map((message) => (
        <p key={message} className="load-status__message">
          <span aria-hidden="true">{SEVERITY_ICON.warning}</span> {message}
        </p>
      ))}
    </div>
  );
}
