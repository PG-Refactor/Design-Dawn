import { Channel } from "@tauri-apps/api/core";
import { parseLanguagePreference } from "../../application/local-state/language";
import { parseThemePreference } from "../../application/local-state/theme";
import type {
  AppRequestSource,
  OpenDocumentRequest,
  ProjectFilesNotice,
  SettingsChange,
} from "../../application/ports/app-request-source";
import { parseDocumentId, parseProjectId } from "../../domain/shared/entity-id";
import { COMMANDS } from "./command-constants";
import { commandOk } from "./command-error";
import { call } from "./invoke-command";
import { toExternalChanges } from "./persistence-payloads";

// `kind` of the notification Rust sends; it must match `AppNotification` in
// `src-tauri/src/commands/app_channel.rs`.
const OPEN_DOCUMENT_KIND = "openDocument";
const SETTINGS_CHANGED_KIND = "settingsChanged";
const PROJECT_FILES_CHANGED_KIND = "projectFilesChanged";

function toOpenDocumentRequest(message: unknown): OpenDocumentRequest | null {
  if (typeof message !== "object" || message === null) return null;
  const { kind, requestId, documentId } = message as Record<string, unknown>;
  if (
    kind !== OPEN_DOCUMENT_KIND ||
    typeof requestId !== "string" ||
    typeof documentId !== "string"
  ) {
    return null;
  }
  const parsed = parseDocumentId(documentId);
  return parsed.ok ? { requestId, documentId: parsed.value } : null;
}

function toSettingsChange(message: unknown): SettingsChange | null {
  if (typeof message !== "object" || message === null) return null;
  const { kind, themePreference, languagePreference, autoSave } =
    message as Record<string, unknown>;
  if (
    kind !== SETTINGS_CHANGED_KIND ||
    typeof themePreference !== "string" ||
    typeof languagePreference !== "string" ||
    typeof autoSave !== "boolean"
  ) {
    return null;
  }
  const theme = parseThemePreference(themePreference);
  const language = parseLanguagePreference(languagePreference);
  return theme.ok && language.ok
    ? {
        themePreference: theme.value,
        languagePreference: language.value,
        autoSave,
      }
    : null;
}

function toProjectFilesNotice(message: unknown): ProjectFilesNotice | null {
  if (typeof message !== "object" || message === null) return null;
  const { kind, projectId } = message as Record<string, unknown>;
  if (kind !== PROJECT_FILES_CHANGED_KIND || typeof projectId !== "string") {
    return null;
  }
  const parsedProjectId = parseProjectId(projectId);
  const changes = toExternalChanges(message);
  return parsedProjectId.ok && changes.ok
    ? { projectId: parsedProjectId.value, changes: changes.value }
    : null;
}

// Requests arrive on an IPC channel for the same reason as close requests: listening to
// events would need a `core:*` permission, which the capability does not grant.
export function createTauriAppRequestSource(): AppRequestSource {
  const listeners = new Set<(request: OpenDocumentRequest) => void>();
  const settingsListeners = new Set<(change: SettingsChange) => void>();
  const projectFilesListeners = new Set<(notice: ProjectFilesNotice) => void>();
  let channel: Channel<unknown> | null = null;

  // A malformed message can only come from a bug on the Rust side. It stays
  // unacknowledged there, so it is ignored rather than half-applied.
  function dispatch(message: unknown): void {
    const request = toOpenDocumentRequest(message);
    if (request !== null) {
      for (const listener of [...listeners]) listener(request);
      return;
    }
    const change = toSettingsChange(message);
    if (change !== null) {
      for (const listener of [...settingsListeners]) listener(change);
      return;
    }
    const notice = toProjectFilesNotice(message);
    if (notice === null) return;
    for (const listener of [...projectFilesListeners]) listener(notice);
  }

  // One channel per source, created on the first subscription: Rust keeps only the latest
  // one, so subscribing again would cut off the channel in use. Subscribing makes Rust send
  // what the window has not acknowledged yet.
  function ensureSubscribed(): void {
    if (channel !== null) return;
    const created = new Channel<unknown>();
    created.onmessage = dispatch;
    channel = created;
    void call(COMMANDS.subscribeAppRequests, { channel: created }, () =>
      commandOk(undefined),
    ).then((result) => {
      if (!result.ok)
        console.error("failed to subscribe to app requests", result.error);
    });
  }

  return {
    subscribe(listener) {
      ensureSubscribed();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeSettings(listener) {
      ensureSubscribed();
      settingsListeners.add(listener);
      return () => {
        settingsListeners.delete(listener);
      };
    },
    subscribeProjectFiles(listener) {
      ensureSubscribed();
      projectFilesListeners.add(listener);
      return () => {
        projectFilesListeners.delete(listener);
      };
    },
    acknowledgeOpenRequest(requestId) {
      return call(COMMANDS.ackOpenRequest, { requestId }, () =>
        commandOk(undefined),
      );
    },
  };
}
