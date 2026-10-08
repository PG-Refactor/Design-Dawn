// Port for requests Rust sends to this window while it runs (docs/architecture.md §11.0.1):
// "open this Document" for a Project the window already has, when a `.dawn` is opened again
// from outside. Rust keeps a request until the window acknowledges it, and routes it again
// when the window goes away first.

import type { DocumentId } from "../../domain/shared/entity-id";
import type { OperationResult } from "./operation-error";

export interface OpenDocumentRequest {
  // Echoed back by `acknowledgeOpenRequest`.
  readonly requestId: string;
  readonly documentId: DocumentId;
}

export interface AppRequestSource {
  // Returns the unsubscribe function.
  subscribe(listener: (request: OpenDocumentRequest) => void): () => void;
  // Tells Rust the request was handled (or deliberately set aside), so it is not routed
  // again. An unknown id is not an error.
  acknowledgeOpenRequest(requestId: string): Promise<OperationResult<void>>;
}
