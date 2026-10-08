import type { OperationResult } from "../../application/ports/operation-error";
import type {
  CloseRequest,
  CloseRequestSource,
} from "../../application/ports/window-close";
import type { UnsavedCloseChoice } from "./workspace-actions";

export interface WindowCloseDependencies {
  // Read at request time, so the controller always uses the latest services.
  readonly saveAll: () => Promise<OperationResult<void>>;
  readonly flushViewport: () => Promise<void>;
  readonly closeRequestSource: CloseRequestSource;
  // Auto-save off with unsaved changes: the user is asked before anything happens.
  readonly needsConfirmation: () => boolean;
  readonly askUnsavedClose: () => Promise<UnsavedCloseChoice>;
}

// Callable with the close request; also tells whether a close is in progress and when it
// stopped (cancelled or failed), so other window-level work (app requests) can wait for it
// without keeping a second copy of the flag.
export interface WindowCloseHandler {
  (request: CloseRequest): Promise<void>;
  isClosing(): boolean;
  // Called whenever a close that was in progress ended without closing the window. Returns
  // the unsubscribe function.
  onReleased(listener: () => void): () => void;
}

// Saves, then asks Rust to close (docs/architecture.md §10.1). Order is strict: saveAll,
// viewport flush, confirm. "Close without saving" (auto-save off, chosen by the user) skips
// only the saveAll. The "in progress" flag lives in this closure rather than in a
// store: a page reload drops the closure and the flag with it, so a stale flag can never
// keep a fresh page from closing.
export function createWindowCloseHandler(
  getDependencies: () => WindowCloseDependencies,
): WindowCloseHandler {
  let processing = false;
  const releasedListeners = new Set<() => void>();

  function release(): void {
    processing = false;
    for (const listener of [...releasedListeners]) listener();
  }

  async function handle(request: CloseRequest): Promise<void> {
    // A repeated request must not start a second save, nor force the window closed.
    if (processing) return;
    processing = true;
    const {
      saveAll,
      flushViewport,
      closeRequestSource,
      needsConfirmation,
      askUnsavedClose,
    } = getDependencies();
    try {
      // The flag stays set while the question is open, so a repeated request is ignored.
      const choice = needsConfirmation() ? await askUnsavedClose() : "save";
      if (choice === "cancel") {
        // Reset, so a later close request asks again.
        release();
        return;
      }
      if (choice === "save") {
        const saved = await saveAll();
        // The failure is already shown as a save / operation error; the window stays open
        // so the user can retry.
        if (!saved.ok) {
          release();
          return;
        }
      }
      try {
        await flushViewport();
      } catch {
        // The viewport is local, re-creatable state, not document data: losing it must not
        // keep the window open once the document is saved.
      }
      const confirmed = await closeRequestSource.confirmClose(
        request.subscriptionToken,
      );
      if (!confirmed.ok) release();
    } catch (error) {
      // An unexpected throw must not leave the flag set, or the window could never close.
      release();
      throw error;
    }
  }

  return Object.assign(handle, {
    isClosing: () => processing,
    onReleased(listener: () => void) {
      releasedListeners.add(listener);
      return () => {
        releasedListeners.delete(listener);
      };
    },
  });
}
