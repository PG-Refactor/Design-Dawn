// Port for "the user asked to close the window". Rust stops the close and announces it with
// an opaque token; the window is closed only when the Frontend
// confirms with that token after saving.

import type { OperationResult } from "./operation-error";

export interface CloseRequest {
  // Identifies the subscription the request came from; echoed back by `confirmClose`.
  readonly subscriptionToken: string;
}

export interface CloseRequestSource {
  // Returns the unsubscribe function.
  subscribe(listener: (request: CloseRequest) => void): () => void;
  // Asks Rust to close the window. Rust ignores a token from a replaced subscription.
  confirmClose(subscriptionToken: string): Promise<OperationResult<void>>;
}
