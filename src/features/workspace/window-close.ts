import type { OperationResult } from "../../application/ports/operation-error";
import type {
  CloseRequest,
  CloseRequestSource,
} from "../../application/ports/window-close";
import type { UnsavedCloseChoice } from "./workspace-actions";

export interface WindowCloseDependencies {
  // Read at request time, so the controller always uses the latest services.
  readonly saveAll: () => Promise<OperationResult<void>>;
  // Waits for the views being saved with the Documents (unsaved views are not saved:
  // closing without saving leaves the view as it was saved last).
  readonly finishViewportSaves: () => Promise<void>;
  readonly closeRequestSource: CloseRequestSource;
  // Auto-save off with unsaved changes: the user is asked before anything happens.
  readonly needsConfirmation: () => boolean;
  readonly askUnsavedClose: () => Promise<UnsavedCloseChoice>;
  // Print windows of this window: asked about first (stop printing and close?), and
  // closed before anything else happens.
  readonly printing?: {
    readonly isOpen: () => Promise<boolean>;
    readonly confirmStop: () => Promise<boolean>;
    readonly closeAll: () => Promise<void>;
  };
  // A window that edits a Custom Template: what matters is the template, not the window's
  // working copy, so it asks about the template (and never about the working copy).
  readonly templateEdit?: {
    readonly isEditing: () => boolean;
    readonly hasUnsavedChanges: () => Promise<boolean>;
    readonly ask: () => Promise<"save" | "discard" | "cancel">;
    readonly save: () => Promise<OperationResult<void>>;
  };
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

// Saves, then asks Rust to close. Order is strict: saveAll,
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
      finishViewportSaves,
      closeRequestSource,
      needsConfirmation,
      askUnsavedClose,
      printing,
      templateEdit,
    } = getDependencies();
    try {
      if (printing !== undefined && (await printing.isOpen())) {
        // Every question below is asked in front: the close may come from the taskbar of a
        // window behind others (or minimized).
        await closeRequestSource.bringForward();
        if (!(await printing.confirmStop())) {
          release();
          return;
        }
        await printing.closeAll();
      }
      if (templateEdit?.isEditing() === true) {
        if (await templateEdit.hasUnsavedChanges()) {
          await closeRequestSource.bringForward();
          const answer = await templateEdit.ask();
          if (answer === "cancel") {
            release();
            return;
          }
          if (answer === "save" && !(await templateEdit.save()).ok) {
            release();
            return;
          }
        }
        const confirmedEdit = await closeRequestSource.confirmClose(
          request.subscriptionToken,
        );
        if (!confirmedEdit.ok) release();
        return;
      }
      // The flag stays set while the question is open, so a repeated request is ignored.
      const asks = needsConfirmation();
      if (asks) await closeRequestSource.bringForward();
      const choice = asks ? await askUnsavedClose() : "save";
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
        await finishViewportSaves();
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
