import { useId, useRef, useState } from "react";
import { ConfirmDialog } from "../workspace/confirm-dialog";
import { Modal } from "../workspace/modal";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { confirmGitRemote, confirmGitStageAll } from "./git-action-flow";

// Smart commit: nothing is staged. Cancel has the initial focus (the "yes" stages
// everything), Escape cancels.
export function GitStageAllDialog({ busy }: { readonly busy: boolean }) {
  const services = useWorkspaceServices();
  const messages = useMessages();
  const texts = messages.git.stageAllDialog;
  return (
    <ConfirmDialog
      title={texts.title}
      paragraphs={[]}
      cancelLabel={messages.workspace.dialogs.cancel}
      confirmLabel={texts.confirm}
      confirmVariant="primary"
      busy={busy}
      onCancel={services.actions.cancelDialog}
      onConfirm={() => void confirmGitStageAll(services)}
    />
  );
}

// Which remote to publish to. The names come from the repository: text only. The first is
// preselected so Enter on the confirm button always has an answer.
export function GitRemoteDialog({
  remoteNames,
  busy,
}: {
  readonly remoteNames: readonly string[];
  readonly busy: boolean;
}) {
  const services = useWorkspaceServices();
  const messages = useMessages();
  const texts = messages.git.remoteDialog;
  const titleId = useId();
  const groupName = useId();
  const firstOption = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState(remoteNames[0] ?? "");
  return (
    <Modal
      titleId={titleId}
      onCancel={services.actions.cancelDialog}
      initialFocusRef={firstOption}
      busy={busy}
    >
      <h2 id={titleId} className="modal__title">
        {texts.title}
      </h2>
      <fieldset className="modal__body git-remote-choices">
        <legend className="git-visually-hidden">{texts.listLabel}</legend>
        {remoteNames.map((name, index) => (
          <label key={name} className="git-remote-choices__option">
            <input
              ref={index === 0 ? firstOption : undefined}
              type="radio"
              name={groupName}
              value={name}
              checked={selected === name}
              onChange={() => setSelected(name)}
            />
            <span>{name}</span>
          </label>
        ))}
      </fieldset>
      <div className="modal__actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={services.actions.cancelDialog}
        >
          {messages.workspace.dialogs.cancel}
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={busy || selected === ""}
          onClick={() => void confirmGitRemote(services, selected)}
        >
          {texts.confirm}
        </button>
      </div>
    </Modal>
  );
}
