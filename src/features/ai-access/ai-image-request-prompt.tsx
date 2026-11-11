import { useEffect, useId, useRef, useState } from "react";
import type { WindowEvent } from "../../application/ports/app-request-source";
import { measureActiveCanvas } from "../canvas/block-dom";
import { Modal } from "../workspace/modal";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import "./ai-access-dialog.css";

type AiImageRequest = Extract<WindowEvent, { kind: "aiImageRequested" }>;

// Asks the user when an AI wants to add an image file to a Sheet: the picture is shown
// (read and validated by Rust), and only "Add" imports it and places the Image Block.
// Requests wait in a queue; closing the question (Escape) is a "don't add".
export function AiImageRequestPrompt() {
  const texts = useMessages().aiAccess.imageRequest;
  const {
    appRequestSource,
    aiAccess,
    actions,
    canvasActions,
    applicationStore,
  } = useWorkspaceServices();
  const titleId = useId();
  const descriptionId = useId();
  const denyRef = useRef<HTMLButtonElement>(null);
  const [queue, setQueue] = useState<readonly AiImageRequest[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(
    () =>
      appRequestSource.subscribeWindowEvents((event) => {
        if (event.kind !== "aiImageRequested") return;
        setQueue((waiting) =>
          waiting.some((request) => request.requestId === event.requestId)
            ? waiting
            : [...waiting, event],
        );
      }),
    [appRequestSource],
  );

  const request = queue[0];
  useEffect(() => {
    setPreview(null);
    setPreviewFailed(false);
    if (request === undefined) return;
    let current = true;
    void aiAccess.imageRequestPreview(request.requestId).then((read) => {
      if (!current) return;
      if (read.ok) setPreview(read.value);
      else setPreviewFailed(true);
    });
    return () => {
      current = false;
    };
  }, [request, aiAccess]);

  if (request === undefined) return null;

  const application = applicationStore.getState();
  const documentName =
    application.project?.documents.find(
      (entry) => entry.documentId === request.documentId,
    )?.name ?? request.documentId;
  const sheetName =
    application.documents.get(request.documentId)?.sheets.get(request.sheetId)
      ?.name ?? request.sheetId;

  async function answer(allow: boolean): Promise<void> {
    if (request === undefined || busy) return;
    setBusy(true);
    setFailed(false);
    let ok = true;
    if (allow) {
      // The file goes into the Document's assets, which needs the Document open here.
      const opened = await actions.openDocument(request.documentId);
      ok = opened.ok;
    }
    const answered = ok
      ? await aiAccess.answerImageRequest(request.requestId, allow)
      : null;
    if (answered?.ok === true && answered.value !== null) {
      const placed = await canvasActions.addImportedImage({
        documentId: request.documentId,
        sheetId: request.sheetId,
        image: answered.value,
        viewportSize: measureActiveCanvas(),
        ...(request.x === null || request.y === null
          ? {}
          : { at: { x: request.x, y: request.y } }),
        ...(request.caption === null ? {} : { caption: request.caption }),
      });
      ok = placed.ok;
    } else if (answered === null || !answered.ok) {
      ok = false;
    }
    setBusy(false);
    if (!ok && allow) setFailed(true);
    setQueue((waiting) => waiting.slice(1));
  }

  return (
    <Modal
      titleId={titleId}
      descriptionId={descriptionId}
      onCancel={() => void answer(false)}
      initialFocusRef={denyRef}
      busy={busy}
    >
      <h2 id={titleId} className="modal__title">
        {texts.title}
      </h2>
      <div className="modal__body">
        <p id={descriptionId}>
          {texts.description(
            request.fileName,
            `${documentName} / ${sheetName}`,
          )}
        </p>
        {preview !== null && (
          <img
            className="ai-image-request__preview"
            src={preview}
            alt={texts.previewLabel}
          />
        )}
        {previewFailed && <p role="alert">{texts.previewFailed}</p>}
        {failed && <p role="alert">{texts.failed}</p>}
      </div>
      <div className="modal__actions">
        <button
          ref={denyRef}
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void answer(false)}
        >
          {texts.deny}
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={busy || previewFailed}
          onClick={() => void answer(true)}
        >
          {texts.allow}
        </button>
      </div>
    </Modal>
  );
}
