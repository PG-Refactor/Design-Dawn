import type { OperationResult } from "../../application/ports/operation-error";
import type {
  CloseDecision,
  CloseRequest,
  CloseRequestSource,
  WindowCloseScope,
} from "../../application/ports/window-close";
import type { UnsavedCloseChoice } from "./workspace-actions";

export interface WindowCloseDependencies {
  // Read at request time, so the controller always uses the latest services.
  readonly saveAll: () => Promise<OperationResult<void>>;
  // Waits for the views being saved with the Documents (unsaved views are not saved:
  // closing without saving leaves the view as it was saved last).
  readonly finishViewportSaves: () => Promise<void>;
  readonly closeRequestSource: CloseRequestSource;
  // Resolves when the steps already under way are done: Rust asks a Document window to
  // close as soon as its last Document is handed over, before this window has let it go,
  // and the questions below must see the window as those steps leave it.
  readonly settled: () => Promise<void>;
  // Auto-save off with unsaved changes: the user is asked before anything happens.
  readonly needsConfirmation: () => boolean;
  // `endsApp`: no other window is left afterwards (the question says the app quits).
  readonly askUnsavedClose: (endsApp: boolean) => Promise<UnsavedCloseChoice>;
  // Resolves once the screen has been drawn again: after an answer the question goes away
  // on screen before the window does (otherwise it stays in the window's last picture).
  readonly afterRepaint?: () => Promise<void>;
  // Print windows of this window: asked about first (stop printing and close?), and
  // closed before anything else happens.
  readonly printing?: {
    readonly isOpen: () => Promise<boolean>;
    readonly confirmStop: () => Promise<boolean>;
    readonly closeAll: () => Promise<void>;
    // Out of the way of the question (they stay in front of their window), and back.
    readonly setHidden?: (hidden: boolean) => Promise<void>;
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

// When the scope cannot be read: the question names only this window, and the Document
// windows are asked to save (nothing is lost).
const UNKNOWN_SCOPE: WindowCloseScope = {
  endsApp: false,
  documentWindowsUnsaved: false,
};

// Saves, then asks Rust to close. Order is strict: saveAll,
// viewport flush, confirm. "Close without saving" (auto-save off, chosen by the user) skips
// only the saveAll. A Project window asks once for its Document windows as well and, once
// it has saved, has them close with the same answer; such a window (`decided`) asks
// nothing. The "in progress" flag lives in this closure rather than in a
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
      settled,
      needsConfirmation,
      askUnsavedClose,
      afterRepaint,
      printing,
      templateEdit,
    } = getDependencies();
    try {
      await settled();
      if (request.decided !== null) {
        await closeAlong(request, request.decided);
        return;
      }
      if (printing !== undefined && (await printing.isOpen())) {
        // Every question below is asked in front: the close may come from the taskbar of a
        // window behind others (or minimized).
        await closeRequestSource.bringForward();
        await printing.setHidden?.(true);
        if (!(await printing.confirmStop())) {
          // Printing goes on: the print window comes back.
          await printing.setHidden?.(false);
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
          await afterRepaint?.();
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
      const read = await closeRequestSource.scope();
      const scope = read.ok ? read.value : UNKNOWN_SCOPE;
      // The flag stays set while the question is open, so a repeated request is ignored.
      const asks = needsConfirmation() || scope.documentWindowsUnsaved;
      if (asks) await closeRequestSource.bringForward();
      const choice = asks ? await askUnsavedClose(scope.endsApp) : "save";
      if (asks && choice !== "cancel") await afterRepaint?.();
      if (choice === "cancel") {
        // Reset, so a later close request asks again.
        release();
        return;
      }
      if (choice === "save" && !(await saved())) return;
      // Only once this window has saved: a failure keeps every window open.
      await closeRequestSource.closeDocumentWindows(choice);
      await confirm(request);
    } catch (error) {
      // An unexpected throw must not leave the flag set, or the window could never close.
      release();
      throw error;
    }

    // Closing along with the Project window, which asked already: print windows simply
    // close, and the answer it got decides the save.
    async function closeAlong(
      closing: CloseRequest,
      decision: CloseDecision,
    ): Promise<void> {
      if (printing !== undefined && (await printing.isOpen())) {
        await printing.closeAll();
      }
      if (decision === "save" && !(await saved())) return;
      await confirm(closing);
    }

    // The failure is already shown as a save / operation error; the window stays open so
    // the user can retry.
    async function saved(): Promise<boolean> {
      const result = await saveAll();
      if (!result.ok) release();
      return result.ok;
    }

    async function confirm(closing: CloseRequest): Promise<void> {
      try {
        await finishViewportSaves();
      } catch {
        // The viewport is local, re-creatable state, not document data: losing it must not
        // keep the window open once the document is saved.
      }
      const confirmed = await closeRequestSource.confirmClose(
        closing.subscriptionToken,
      );
      if (!confirmed.ok) release();
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
