import { useId, useRef } from "react";
import type {
  RepairPromptState,
  RepairRequest,
} from "../../application/load-issue-repair/load-issue-repair-controller";
import { DESTRUCTIVE_REPAIR_ACTIONS } from "../../application/load-issue-repair/repair-catalog";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { ConfirmDialog } from "../workspace/confirm-dialog";
import { Modal } from "../workspace/modal";
import { useMessages } from "../workspace/use-messages";
import { useUiState } from "../workspace/workspace-hooks";
import type { WorkspaceMessages } from "../workspace/workspace-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";

const identity = <Value,>(value: Value): Value => value;
const selectBusy = (ui: { readonly busy: boolean }) => ui.busy;

type RepairTexts = WorkspaceMessages["loadIssueRepair"];

function titleOf(texts: RepairTexts, request: RepairRequest): string {
  switch (request.kind) {
    case "issue":
      return texts.titles[request.action];
    case "reload":
      return texts.titles.reload;
    case "formatUpdate":
      return texts.titles.updateFormat;
  }
}

function descriptionOf(texts: RepairTexts, request: RepairRequest): string {
  switch (request.kind) {
    case "issue":
      return texts.descriptions[request.action];
    case "reload":
      return texts.descriptions.reload;
    case "formatUpdate":
      return texts.descriptions.updateFormat;
  }
}

function confirmLabelOf(
  texts: RepairTexts,
  request: RepairRequest,
  needsSave: boolean,
): string {
  const labels = texts.confirmLabels;
  switch (request.kind) {
    case "issue":
      return needsSave ? labels.saveAndRun : labels.run;
    case "reload":
      return needsSave ? labels.saveAndReload : labels.reload;
    case "formatUpdate":
      return needsSave ? labels.saveAndUpdateFormat : labels.updateFormat;
  }
}

function isDestructive(request: RepairRequest): boolean {
  return (
    request.kind === "issue" &&
    DESTRUCTIVE_REPAIR_ACTIONS.includes(request.action)
  );
}

// The question before any change to files that is not an edit: what will happen, which files
// it reaches and whether unsaved work is saved first. Not in Undo / Redo, hence the notice.
// Opens only when no other modal is open.
export function LoadIssueRepairDialog() {
  const { loadIssueRepairController } = useWorkspaceServices();
  const state = useStoreSelector(loadIssueRepairController.store, identity);
  const otherDialog = useUiState((ui) => ui.dialog.kind);
  if (state.status === "idle" || otherDialog !== "none") return null;
  return <RepairQuestion state={state} />;
}

function RepairQuestion({
  state,
}: {
  readonly state: Exclude<RepairPromptState, { status: "idle" }>;
}) {
  const texts = useMessages().workspace.loadIssueRepair;
  const { loadIssueRepairController: controller } = useWorkspaceServices();
  const uiBusy = useUiState(selectBusy);
  if (state.status === "unavailable") {
    return (
      <UnavailableNotice
        texts={texts}
        reason={texts.unavailableReasons[state.reason]}
        onClose={controller.cancel}
      />
    );
  }
  const paragraphs = [descriptionOf(texts, state.request)];
  if (state.request.kind === "issue") paragraphs.push(texts.undoNotice);
  if (state.needsSave) paragraphs.push(texts.saveFirst);
  return (
    <ConfirmDialog
      title={titleOf(texts, state.request)}
      paragraphs={paragraphs}
      listItems={state.files}
      cancelLabel={texts.cancel}
      confirmLabel={confirmLabelOf(texts, state.request, state.needsSave)}
      confirmVariant={isDestructive(state.request) ? "danger" : "primary"}
      busy={uiBusy || state.status === "running"}
      onCancel={controller.cancel}
      onConfirm={() => void controller.confirm()}
    />
  );
}

function UnavailableNotice({
  texts,
  reason,
  onClose,
}: {
  readonly texts: RepairTexts;
  readonly reason: string;
  readonly onClose: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal
      titleId={titleId}
      descriptionId={descriptionId}
      onCancel={onClose}
      initialFocusRef={closeRef}
      busy={false}
    >
      <h2 id={titleId} className="modal__title">
        {texts.titles.unavailable}
      </h2>
      <div id={descriptionId} className="modal__body">
        <p>{reason}</p>
      </div>
      <div className="modal__actions">
        <button
          ref={closeRef}
          type="button"
          className="button button--primary"
          onClick={onClose}
        >
          {texts.close}
        </button>
      </div>
    </Modal>
  );
}
