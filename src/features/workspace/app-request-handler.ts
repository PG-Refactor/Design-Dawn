import type { OpenDocumentRequest } from "../../application/ports/app-request-source";
import type { OperationResult } from "../../application/ports/operation-error";
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
// what tells Rust not to route it again (docs/architecture.md §11.0.1). While the window is
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
