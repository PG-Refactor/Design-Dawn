import { useCallback, useEffect, useRef } from "react";
import {
  type OperationError,
  type OperationResult,
  operationOk,
} from "../../application/ports/operation-error";
import type { BlockId, DocumentId } from "../../domain/shared/entity-id";
import { addOperationError } from "../workspace/ui-state/shell-ui-state";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { describeRefusal } from "./diagram-gui-text";
import type { MermaidMessages } from "./mermaid-messages";

// The operation label the canvas actions use for diagram edits, so the notification reads
// like any other failed diagram edit.
const DIAGRAM_EDIT_OPERATION = "editDiagram";
const UNAPPLIED_LINE_SEPARATOR = ": ";
const NOTIFICATION_LINE_BREAK = "\n";
// The kind recorded when no application error exists (an add form that was left with text).
const UNAPPLIED_ERROR_KIND = "invalidDiagramOperation";

export type GuiDraftCommit = () => Promise<OperationResult<void>>;

// "explicit": the user asked for it (Enter, Apply, Add), so it always tries again.
// "implicit": a side effect of something else (leaving a field, save-all, changing the
// selection, leaving the editor), so it does not repeat an attempt that was just refused.
export type GuiCommitTrigger = "explicit" | "implicit";

// One value the user typed that is not in the source.
export interface UnappliedValue {
  readonly label: string;
  readonly value: string;
}

export interface GuiFieldDraftOptions {
  readonly documentId: DocumentId;
  readonly blockId: BlockId;
  // Whether a field of the group holds a value that is not committed yet. Reads refs, so
  // it is right even between renders.
  readonly hasPending: () => boolean;
  // The typed values of the group as one string. Together with the committed source it
  // identifies an attempt: the same values against the same text are refused the same way.
  readonly inputKey: () => string;
  // Commits everything pending in the group, the way its Apply / Enter does. This is what
  // save-all and "save" in the unsaved-close dialog run. Ok when there is nothing to
  // commit; a refusal is returned and leaves the input in place.
  readonly commitAll: GuiDraftCommit;
  // The values that are still pending, for the notification written when the editor goes
  // away with them.
  readonly unappliedValues: () => readonly UnappliedValue[];
  // What leaving the editor does with a pending draft: "commit" tries the commit as a safety
  // net (like the Source editor), "keep" applies nothing (the add form, which only adds on
  // Enter / the Add button) and only reports the lost input.
  readonly onUnmount: "commit" | "keep";
}

export interface GuiFieldDraft {
  // Runs one commit of this group (`commitAll` or a single field's). Commits of a group run
  // one at a time: a caller that finds one running waits for it and then runs its own, which
  // re-checks what is still pending. Does nothing once the draft was discarded. An implicit
  // trigger returns the earlier refusal instead of repeating an attempt with the same
  // values against the same source text.
  readonly commit: (
    core: GuiDraftCommit,
    trigger: GuiCommitTrigger,
  ) => Promise<OperationResult<void>>;
}

type GuiMessages = MermaidMessages["gui"];

function unappliedDetail(
  gui: GuiMessages,
  values: readonly UnappliedValue[],
  reason: string,
): string {
  const lines = values.map(
    (entry) => `${entry.label}${UNAPPLIED_LINE_SEPARATOR}${entry.value}`,
  );
  return [
    gui.unappliedHeading,
    ...lines,
    `${gui.unappliedReasonLabel}${UNAPPLIED_LINE_SEPARATOR}${reason}`,
  ].join(NOTIFICATION_LINE_BREAK);
}

// Registers a group of GUI input fields in the DraftRegistry while it is mounted, so save-all
// and the unsaved-close check see its uncommitted values like a Source draft.
// The same rules as `TextBlockEditor`: committing is one
// application command, "close without saving" discards, and leaving the editor commits what
// is still pending unless it was discarded (the add form excepted, see `onUnmount`).
export function useGuiFieldDraft(options: GuiFieldDraftOptions): GuiFieldDraft {
  const { draftRegistry, uiStateStore, applicationStore } =
    useWorkspaceServices();
  const gui = useMessages().mermaid.gui;
  const { documentId } = options;
  // The latest closures, read by the registered committer and the unmount cleanup, which
  // are created once.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const guiRef = useRef(gui);
  guiRef.current = gui;
  const inFlightRef = useRef<Promise<OperationResult<void>> | null>(null);
  const discardedRef = useRef(false);
  // The last refused attempt: what was typed and the committed text it was refused against.
  const refusedRef = useRef<{
    readonly key: string;
    readonly result: OperationResult<void>;
  } | null>(null);

  // Read from the store, not from props: the store is updated before React renders again.
  const attemptKey = useCallback((): string => {
    const current = optionsRef.current;
    const source =
      applicationStore
        .getState()
        .documents.get(current.documentId)
        ?.contents.get(current.blockId) ?? "";
    return JSON.stringify([current.inputKey(), source]);
  }, [applicationStore]);

  const commit = useCallback(
    async (
      core: GuiDraftCommit,
      trigger: GuiCommitTrigger,
    ): Promise<OperationResult<void>> => {
      while (inFlightRef.current !== null) await inFlightRef.current;
      if (discardedRef.current) return operationOk(undefined);
      if (trigger === "implicit") {
        const refused = refusedRef.current;
        if (
          refused !== null &&
          optionsRef.current.hasPending() &&
          refused.key === attemptKey()
        ) {
          return refused.result;
        }
      }
      const task = (async (): Promise<OperationResult<void>> => {
        try {
          const result = await core();
          if (!result.ok) {
            // Keyed after the attempt: a partly applied group changed the text it ran
            // against, and the refusal belongs to the text that is there now.
            refusedRef.current = { key: attemptKey(), result };
          } else if (!optionsRef.current.hasPending()) {
            refusedRef.current = null;
          }
          return result;
        } finally {
          inFlightRef.current = null;
        }
      })();
      inFlightRef.current = task;
      return task;
    },
    [attemptKey],
  );

  useEffect(
    () =>
      draftRegistry.register({
        documentId,
        hasPendingDraft: () =>
          !discardedRef.current && optionsRef.current.hasPending(),
        commitDraft: () =>
          commit(() => optionsRef.current.commitAll(), "implicit"),
        discardDraft: () => {
          discardedRef.current = true;
        },
      }),
    [draftRegistry, documentId, commit],
  );

  // Safety net for leaving the editor (sheet switch, closing, the GUI turning uneditable).
  // Only when there is something new, so the simulated unmount of development StrictMode
  // does nothing. Once the editor is gone there is no field left to hold the text and no
  // inline message, so whatever was not applied goes to the notifications with its exact
  // values: it must not vanish silently, and it is never applied later.
  useEffect(
    () => () => {
      const current = optionsRef.current;
      if (discardedRef.current || !current.hasPending()) return;
      const report = (error: OperationError | null): void => {
        const messages = guiRef.current;
        const refusal =
          error === null ? null : describeRefusal(messages, error);
        const reason =
          refusal === null
            ? messages.unappliedAddReason
            : [refusal.message, refusal.mermaidMessage]
                .filter((part) => part !== null)
                .join(NOTIFICATION_LINE_BREAK);
        const detail = unappliedDetail(
          messages,
          optionsRef.current.unappliedValues(),
          reason,
        );
        uiStateStore.setState((state) =>
          addOperationError(state, DIAGRAM_EDIT_OPERATION, null, {
            kind: error?.kind ?? UNAPPLIED_ERROR_KIND,
            detail,
          }),
        );
      };
      if (current.onUnmount === "keep") {
        report(null);
        return;
      }
      void commit(() => optionsRef.current.commitAll(), "implicit").then(
        (result) => {
          if (!result.ok) report(result.error);
        },
      );
    },
    [commit, uiStateStore],
  );

  return { commit };
}
