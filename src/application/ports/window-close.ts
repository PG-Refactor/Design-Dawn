// Port for "the user asked to close the window". Rust stops the close and announces it with
// an opaque token; the window is closed only when the Frontend
// confirms with that token after saving.

import type { OperationResult } from "./operation-error";

// The answer a window closes with when its Project window asked the user for it.
export type CloseDecision = "save" | "discard";

export interface CloseRequest {
  // Identifies the subscription the request came from; echoed back by `confirmClose`.
  readonly subscriptionToken: string;
  // Set when the window closes along with its Project window, which already asked; null
  // when the user asked this window to close.
  readonly decided: CloseDecision | null;
}

// What closing this window takes with it.
export interface WindowCloseScope {
  // No other window is left afterwards: the app ends.
  readonly endsApp: boolean;
  // A Document window closing along with this Project window has changes a close would
  // ask about.
  readonly documentWindowsUnsaved: boolean;
}

export interface CloseRequestSource {
  // Returns the unsubscribe function.
  subscribe(listener: (request: CloseRequest) => void): () => void;
  // Asks Rust to close the window. Rust ignores a token from a replaced subscription.
  confirmClose(subscriptionToken: string): Promise<OperationResult<void>>;
  // Brings this window to the front (restored from the taskbar, focused) before a question
  // about the close is asked. Never fails: the question is asked either way.
  bringForward(): Promise<void>;
  scope(): Promise<OperationResult<WindowCloseScope>>;
  // Tells Rust whether this window has changes a close would ask about, so its Project
  // window can ask for it.
  reportUnsaved(unsaved: boolean): Promise<void>;
  // This Project window closes: its Document windows close too, with `decision`.
  closeDocumentWindows(decision: CloseDecision): Promise<void>;
}
