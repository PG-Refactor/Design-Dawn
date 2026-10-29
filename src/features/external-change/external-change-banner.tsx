import { useState } from "react";
import type { DocumentId } from "../../domain/shared/entity-id";
import { ConfirmDialog } from "../workspace/confirm-dialog";
import { useMessages } from "../workspace/use-messages";
import { useUiState } from "../workspace/workspace-hooks";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import {
  type ConflictSubject,
  targetOf,
  useExternalChangeState,
  useWouldLoseWork,
} from "./use-external-change";
import "./external-change.css";

const selectBusy = (ui: { readonly busy: boolean }) => ui.busy;

type Confirming = "reload" | "overwrite" | null;

// Shown above a Document (or the whole workspace for the Project) after the user chose to
// keep the current content: saving is stopped, and the way out stays one click away.
export function ExternalChangeBanner({
  subject,
}: {
  readonly subject: ConflictSubject;
}) {
  const texts = useMessages().workspace.externalChange;
  const { externalChangeController } = useWorkspaceServices();
  const busy = useUiState(selectBusy);
  const wouldLoseWork = useWouldLoseWork(subject);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const target = targetOf(subject);
  const reload = () => {
    setConfirming(null);
    void externalChangeController.reload(target);
  };
  const overwrite = () => {
    setConfirming(null);
    void externalChangeController.overwrite(target);
  };
  return (
    <>
      <div
        className="external-change__banner"
        role="status"
        aria-label={texts.bannerLabel}
      >
        <span className="external-change__banner-text">
          {subject.kind === "project" ? `${texts.projectBannerSource}: ` : ""}
          {texts.keptBanner}
        </span>
        {subject.conflict.status === "conflict" ? (
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => externalChangeController.keepCurrent(target)}
          >
            {texts.keepCurrent}
          </button>
        ) : null}
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => setConfirming("overwrite")}
        >
          {texts.overwrite}
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={wouldLoseWork ? () => setConfirming("reload") : reload}
        >
          {texts.reload}
        </button>
      </div>
      {confirming === "reload" ? (
        <ConfirmDialog
          title={texts.reloadConfirmTitle}
          paragraphs={[texts.reloadConfirmBody]}
          cancelLabel={texts.cancel}
          confirmLabel={texts.reloadConfirm}
          busy={busy}
          onCancel={() => setConfirming(null)}
          onConfirm={reload}
        />
      ) : null}
      {confirming === "overwrite" ? (
        <ConfirmDialog
          title={texts.overwriteConfirmTitle}
          paragraphs={[texts.overwriteConfirmBody]}
          cancelLabel={texts.cancel}
          confirmLabel={texts.overwriteConfirm}
          busy={busy}
          onCancel={() => setConfirming(null)}
          onConfirm={overwrite}
        />
      ) : null}
    </>
  );
}

// The banner of the Document in the active tab, if its conflict was kept.
export function ActiveDocumentBanner({
  documentId,
  always = false,
}: {
  readonly documentId: DocumentId;
  // Also for a conflict that still waits for the user's answer (the compare tab).
  readonly always?: boolean;
}) {
  const state = useExternalChangeState();
  const conflict = state.conflicts.find(
    (entry) =>
      entry.documentId === documentId && (always || entry.status === "kept"),
  );
  if (conflict === undefined) return null;
  return (
    <ExternalChangeBanner
      subject={{ kind: "document", conflict, name: null }}
    />
  );
}

// The banner of the Project-level conflict, if it was kept.
export function ProjectBanner() {
  const { projectConflict } = useExternalChangeState();
  if (projectConflict === null || projectConflict.status !== "kept")
    return null;
  return (
    <ExternalChangeBanner
      subject={{ kind: "project", conflict: projectConflict }}
    />
  );
}
