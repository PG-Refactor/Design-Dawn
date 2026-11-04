import { useEffect, useId, useRef, useState } from "react";
import type { AiAccessAnswer } from "../../application/ports/ai-access-gateway";
import type { WindowEvent } from "../../application/ports/app-request-source";
import { Modal } from "../workspace/modal";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import "./ai-access-dialog.css";

type AiAccessRequest = Extract<WindowEvent, { kind: "aiAccessRequested" }>;

// Asks the user when an AI wants to edit a Project. Only the answer given here changes
// what the AI may do; the request itself grants nothing. Requests wait in a queue, one
// question at a time; closing the question (Escape) is a "no".
export function AiAccessRequestPrompt() {
  const texts = useMessages().aiAccess;
  const { appRequestSource, aiAccess } = useWorkspaceServices();
  const titleId = useId();
  const descriptionId = useId();
  const denyRef = useRef<HTMLButtonElement>(null);
  const [queue, setQueue] = useState<readonly AiAccessRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(
    () =>
      appRequestSource.subscribeWindowEvents((event) => {
        if (event.kind !== "aiAccessRequested") return;
        setQueue((waiting) =>
          waiting.some((request) => request.projectId === event.projectId)
            ? waiting
            : [...waiting, event],
        );
      }),
    [appRequestSource],
  );

  const request = queue[0];
  if (request === undefined) return null;

  async function answer(given: AiAccessAnswer): Promise<void> {
    if (request === undefined || busy) return;
    setBusy(true);
    setFailed(false);
    const result = await aiAccess.answerRequest(request.projectId, given);
    setBusy(false);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    setQueue((waiting) => waiting.slice(1));
  }

  return (
    <Modal
      titleId={titleId}
      descriptionId={descriptionId}
      onCancel={() => void answer("deny")}
      initialFocusRef={denyRef}
      busy={busy}
    >
      <h2 id={titleId} className="modal__title">
        {texts.requestTitle}
      </h2>
      <div className="modal__body ai-access">
        <p id={descriptionId}>{texts.requestBody(request.projectName)}</p>
        <p className="ai-access__project-folder">{request.folderDisplay}</p>
        <p>{texts.requestEffect}</p>
        <p className="ai-access__hint">{texts.requestSettingsHint}</p>
        {failed && (
          <p className="ai-access__warning" role="alert">
            {texts.requestFailed}
          </p>
        )}
      </div>
      <div className="modal__actions ai-access__request-actions">
        <button
          ref={denyRef}
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void answer("deny")}
        >
          {texts.requestDeny}
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void answer("allowUntilAppExits")}
        >
          {texts.requestAllowUntilAppExits}
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={busy}
          onClick={() => void answer("allow")}
        >
          {texts.requestAllow}
        </button>
      </div>
    </Modal>
  );
}
