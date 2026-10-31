import type { ThemePreference } from "../../application/local-state/theme";
import type {
  OpenDocumentRequest,
  SettingsChange,
} from "../../application/ports/app-request-source";
import type { OperationResult } from "../../application/ports/operation-error";
import type { LanguagePreference } from "../../config/language-config";
import type { TextSize } from "../../config/text-size-config";
import type { DocumentId } from "../../domain/shared/entity-id";

export interface AppRequestHandlerDependencies {
  // Opens (or activates) the Document; failures are already shown by the action itself.
  readonly openDocument: (
    documentId: DocumentId,
  ) => Promise<OperationResult<void>>;
  readonly acknowledge: (requestId: string) => Promise<OperationResult<void>>;
  // True while the window's close handling is in progress (see `WindowCloseHandler`).
  readonly isClosing: () => boolean;
  // Resolves when the window finished installing the request it was started with, so an
  // `openDocument` never arrives before its Project is open.
  readonly whenReady: () => Promise<unknown>;
}

export interface AppRequestHandler {
  handle(request: OpenDocumentRequest): void;
  // Continues with what was queued: called when a close that was in progress stopped.
  resume(): void;
  // After this nothing is processed any more (the window's UI is gone).
  dispose(): void;
}

// Processes `openDocument` requests from Rust one at a time and acknowledges each, which is
// what tells Rust not to route it again. While the window is
// closing nothing is handled or acknowledged: the request waits in the queue, and if the
// window is destroyed instead, Rust routes the unacknowledged request to a new window.
export function createAppRequestHandler(
  dependencies: AppRequestHandlerDependencies,
): AppRequestHandler {
  const queue: OpenDocumentRequest[] = [];
  // Queued or being processed. Rust may deliver a request again (a re-subscription), and
  // one request must not open twice.
  const knownIds = new Set<string>();
  let draining = false;
  let disposed = false;

  async function drain(): Promise<void> {
    if (draining || disposed) return;
    draining = true;
    try {
      await dependencies.whenReady();
      while (!disposed && !dependencies.isClosing()) {
        const request = queue.shift();
        if (request === undefined) break;
        await dependencies.openDocument(request.documentId);
        // Acknowledged whether or not opening worked: a failure is shown to the user, and
        // routing the same request again would only repeat it.
        const acknowledged = await dependencies.acknowledge(request.requestId);
        if (!acknowledged.ok) {
          console.error(
            "failed to acknowledge an open request",
            acknowledged.error,
          );
        }
        knownIds.delete(request.requestId);
      }
    } finally {
      draining = false;
    }
  }

  return {
    handle(request) {
      if (disposed || knownIds.has(request.requestId)) return;
      knownIds.add(request.requestId);
      queue.push(request);
      void drain();
    },
    resume() {
      void drain();
    },
    dispose() {
      disposed = true;
    },
  };
}

export interface SettingsChangeTargets {
  readonly applyThemePreference: (preference: ThemePreference) => void;
  readonly applyLanguagePreference: (preference: LanguagePreference) => void;
  readonly applyTextSize: (size: TextSize) => void;
  readonly applyAutoSave: (enabled: boolean) => void;
}

// Hands a `settingsChanged` from Rust to the controllers that own the settings. Not queued
// and not acknowledged (unlike `openDocument`): applying is idempotent, and a window that
// misses one reads the settings when it starts. The Project Tree width is not part of it.
export function createSettingsChangeHandler(
  targets: SettingsChangeTargets,
): (change: SettingsChange) => void {
  return (change) => {
    targets.applyThemePreference(change.themePreference);
    targets.applyLanguagePreference(change.languagePreference);
    targets.applyTextSize(change.textSize);
    targets.applyAutoSave(change.autoSave);
  };
}
