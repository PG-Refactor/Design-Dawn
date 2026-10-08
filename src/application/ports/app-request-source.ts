// Port for requests Rust sends to this window while it runs (docs/architecture.md §11.0.1):
// "open this Document" for a Project the window already has, when a `.dawn` is opened again
// from outside. Rust keeps a request until the window acknowledges it, and routes it again
// when the window goes away first.

import type { DocumentId } from "../../domain/shared/entity-id";
import type { ThemePreference } from "../local-state/theme";
import type { OperationResult } from "./operation-error";

export interface OpenDocumentRequest {
  // Echoed back by `acknowledgeOpenRequest`.
  readonly requestId: string;
  readonly documentId: DocumentId;
}

// The theme and auto-save values after another window changed them (docs/architecture.md
// §11.0.1). The Project Tree width is per window and is never sent.
export interface SettingsChange {
  readonly themePreference: ThemePreference;
  readonly autoSave: boolean;
}

export interface AppRequestSource {
  // Returns the unsubscribe function.
  subscribe(listener: (request: OpenDocumentRequest) => void): () => void;
  // Subscribing to either kind makes Rust send what the window has not acknowledged yet,
  // so the `subscribe` listener must be registered first (an open request that arrives
  // without a listener is dropped and stays unacknowledged).
  subscribeSettings(listener: (change: SettingsChange) => void): () => void;
  // Tells Rust the request was handled (or deliberately set aside), so it is not routed
  // again. An unknown id is not an error.
  acknowledgeOpenRequest(requestId: string): Promise<OperationResult<void>>;
}
