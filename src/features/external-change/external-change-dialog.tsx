import { useEffect, useId, useRef, useState } from "react";
import { ConfirmDialog } from "../workspace/confirm-dialog";
import { Modal } from "../workspace/modal";
import { useMessages } from "../workspace/use-messages";
import { useUiState } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { ChangedFileList, type FileComparison } from "./external-change-files";
import { openExternalCompare } from "./open-external-compare";
import {
  type ConflictSubject,
  documentNameOf,
  targetOf,
  useAppState,
  useExternalChangeState,
  useTextContentPaths,
  useWouldLoseWork,
} from "./use-external-change";
import "./external-change.css";

const selectDialogKind = (ui: { readonly dialog: { readonly kind: string } }) =>
  ui.dialog.kind;
const selectBusy = (ui: { readonly busy: boolean }) => ui.busy;

// The first conflict that waits for an answer, Documents before the Project.
function useAskedSubject(): ConflictSubject | null {
  const state = useExternalChangeState();
  const application = useAppState();
  const asked = state.conflicts.find((entry) => entry.status === "conflict");
  if (asked !== undefined) {
    return {
      kind: "document",
      conflict: asked,
      name: documentNameOf(application, asked.documentId),
    };
  }
  return state.projectConflict?.status === "conflict"
    ? { kind: "project", conflict: state.projectConflict }
    : null;
}

// One question at a time, shown when no other modal is open. Esc keeps the current content,
// the side that loses nothing; the first button is focused.
export function ExternalChangeDialog() {
  const subject = useAskedSubject();
  const otherDialog = useUiState(selectDialogKind);
  const comparing = useUiState((ui) => ui.activeMainTab.kind === "compare");
  // The compare tab carries the way to decide itself; the question returns when it is closed.
  if (subject === null || otherDialog !== "none" || comparing) return null;
  return <ConflictQuestion subject={subject} />;
}

function ConflictQuestion({ subject }: { readonly subject: ConflictSubject }) {
  const messages = useMessages().workspace;
  const texts = messages.externalChange;
  const { externalChangeController } = useWorkspaceServices();
  const busy = useUiState(selectBusy);
  const wouldLoseWork = useWouldLoseWork(subject);
  const [confirmingReload, setConfirmingReload] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const keepRef = useRef<HTMLButtonElement>(null);
  const compareRef = useRef<HTMLButtonElement>(null);
  const target = targetOf(subject);
  const services = useWorkspaceServices();
  const documentId =
    subject.kind === "document" ? subject.conflict.documentId : null;
  const textPaths = useTextContentPaths(documentId);
  const comparison: FileComparison | undefined =
    documentId === null
      ? undefined
      : {
          isComparable: (file) => textPaths.has(file.path),
          onCompare: (file) =>
            void openExternalCompare(services, documentId, file.path),
        };
  const firstComparable = subject.conflict.files.find((file) =>
    comparison?.isComparable(file),
  );
  const subjectKey =
    subject.kind === "document" ? subject.conflict.documentId : "project";
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different question starts unconfirmed
  useEffect(() => setConfirmingReload(false), [subjectKey]);

  const keep = () => externalChangeController.keepCurrent(target);
  const reload = () => {
    setConfirmingReload(false);
    void externalChangeController.reload(target);
  };

  if (confirmingReload) {
    return (
      <ConfirmDialog
        title={texts.reloadConfirmTitle}
        paragraphs={[texts.reloadConfirmBody]}
        cancelLabel={texts.cancel}
        confirmLabel={texts.reloadConfirm}
        busy={busy}
        onCancel={() => setConfirmingReload(false)}
        onConfirm={reload}
      />
    );
  }
  const title =
    subject.kind === "project"
      ? texts.projectTitle
      : texts.documentTitle(subject.name ?? messages.tree.unnamedEntity);
  const reasons: string[] = [];
  if (wouldLoseWork) reasons.push(texts.unsavedBody);
  if (
    subject.conflict.files.some(
      (file) => !file.readable && file.change !== "removed",
    )
  ) {
    reasons.push(texts.unreadableBody);
  }
  if (subject.kind === "project" && subject.conflict.structure) {
    reasons.push(texts.structureBody);
  }
  return (
    <Modal
      titleId={titleId}
      descriptionId={descriptionId}
      onCancel={keep}
      initialFocusRef={firstComparable === undefined ? keepRef : compareRef}
      busy={busy}
    >
      <h2 id={titleId} className="modal__title">
        {title}
      </h2>
      <div id={descriptionId} className="modal__body">
        {reasons.map((reason) => (
          <p key={reason}>{reason}</p>
        ))}
        <ChangedFileList
          files={subject.conflict.files}
          comparison={comparison}
        />
      </div>
      <div className="modal__actions">
        {firstComparable === undefined || documentId === null ? null : (
          <button
            ref={compareRef}
            type="button"
            className="button"
            disabled={busy}
            onClick={() =>
              void openExternalCompare(
                services,
                documentId,
                firstComparable.path,
              )
            }
          >
            {texts.compare}
          </button>
        )}
        <button
          ref={keepRef}
          type="button"
          className="button button--primary"
          disabled={busy}
          onClick={keep}
        >
          {texts.keepCurrent}
        </button>
        <button
          type="button"
          className="button button--danger"
          disabled={busy}
          onClick={wouldLoseWork ? () => setConfirmingReload(true) : reload}
        >
          {texts.reload}
        </button>
      </div>
    </Modal>
  );
}
