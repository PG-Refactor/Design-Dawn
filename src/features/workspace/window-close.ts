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

// Saves, then asks Rust to close (docs/architecture.md §10.1). Order is strict: saveAll,
// viewport flush, confirm. "Close without saving" (auto-save off, chosen by the user) skips
// only the saveAll. The "in progress" flag lives in this closure rather than in a
// store: a page reload drops the closure and the flag with it, so a stale flag can never
// keep a fresh page from closing.
export function createWindowCloseHandler(
  getDependencies: () => WindowCloseDependencies,
): (request: CloseRequest) => Promise<void> {
  let processing = false;

  return async (request) => {
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
        processing = false;
        return;
      }
      if (choice === "save") {
        const saved = await saveAll();
        // The failure is already shown as a save / operation error; the window stays open
        // so the user can retry.
        if (!saved.ok) {
          processing = false;
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
      if (!confirmed.ok) processing = false;
    } catch (error) {
      // An unexpected throw must not leave the flag set, or the window could never close.
      processing = false;
      throw error;
    }
  };
}
