// Port for requests Rust sends to this window while it runs:
// "open this Document" for a Project the window already has, when a `.dawn` is opened again
// from outside. Rust keeps a request until the window acknowledges it, and routes it again
// when the window goes away first.

import type { LanguagePreference } from "../../config/language-config";
import type { DocumentId, ProjectId } from "../../domain/shared/entity-id";
import type { ThemePreference } from "../local-state/theme";
import type { OperationResult } from "./operation-error";
import type { ExternalChanges } from "./persistence-types";

export interface OpenDocumentRequest {
  // Echoed back by `acknowledgeOpenRequest`.
  readonly requestId: string;
  readonly documentId: DocumentId;
}

// The theme, language and auto-save values after another window changed them. The Project Tree width is per window and is never sent.
export interface SettingsChange {
  readonly themePreference: ThemePreference;
  readonly languagePreference: LanguagePreference;
  readonly autoSave: boolean;
}

// Files of this window's Project changed behind the app's back.
// May also arrive with nothing to report (`changes` empty) when the watcher saw files the app
// does not track or may have lost events: the Git status behind the window is stale then.
export interface ProjectFilesNotice {
  readonly projectId: ProjectId;
  readonly changes: ExternalChanges;
}

export interface AppRequestSource {
  // Returns the unsubscribe function.
  subscribe(listener: (request: OpenDocumentRequest) => void): () => void;
  // Subscribing to either kind makes Rust send what the window has not acknowledged yet,
  // so the `subscribe` listener must be registered first (an open request that arrives
  // without a listener is dropped and stays unacknowledged).
  subscribeSettings(listener: (change: SettingsChange) => void): () => void;
  // Change notices for the window's Project. Fire and forget: Rust keeps nothing for a window
  // that is not listening (the app compares everything when the window regains focus).
  subscribeProjectFiles(
    listener: (notice: ProjectFilesNotice) => void,
  ): () => void;
  // Tells Rust the request was handled (or deliberately set aside), so it is not routed
  // again. An unknown id is not an error.
  acknowledgeOpenRequest(requestId: string): Promise<OperationResult<void>>;
}
