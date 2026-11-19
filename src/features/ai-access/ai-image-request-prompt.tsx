import { useEffect, useId, useRef, useState } from "react";
import type { WindowEvent } from "../../application/ports/app-request-source";
import { AI_ACCESS_CONFIG } from "../../config/ai-access-config";
import { measureActiveCanvas } from "../canvas/block-dom";
import { Modal } from "../workspace/modal";
import { showNotice } from "../workspace/ui-state/shell-ui-state";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import "./ai-access-dialog.css";

type AiImageRequest = Extract<WindowEvent, { kind: "aiImageRequested" }>;

// What answering a request that is no longer there gets back.
const EXPIRED_KIND = "entityNotFound";

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
    uiStateStore,
  } = useWorkspaceServices();
  const titleId = useId();
  const descriptionId = useId();
  const denyRef = useRef<HTMLButtonElement>(null);
  const [queue, setQueue] = useState<readonly AiImageRequest[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // When each request arrived: it expires a lifetime later, wherever it is in the queue.
  const arrivedAt = useRef(new Map<string, number>());

  useEffect(
    () =>
      appRequestSource.subscribeWindowEvents((event) => {
        if (event.kind !== "aiImageRequested") return;
        if (!arrivedAt.current.has(event.requestId)) {
          arrivedAt.current.set(event.requestId, Date.now());
        }
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

  // The app drops a request nobody answered in time: its question closes and says so.
  useEffect(() => {
    if (request === undefined) return;
    const arrived = arrivedAt.current.get(request.requestId) ?? Date.now();
    const left = Math.max(
      0,
      arrived + AI_ACCESS_CONFIG.requestLifetimeMs - Date.now(),
    );
    const timer = setTimeout(() => {
      arrivedAt.current.delete(request.requestId);
      setQueue((waiting) =>
        waiting.filter((each) => each.requestId !== request.requestId),
      );
      uiStateStore.setState((state) =>
        showNotice(state, "aiImageRequestExpired"),
      );
    }, left);
    return () => clearTimeout(timer);
  }, [request, uiStateStore]);

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
    let ok = true;
    // Rust no longer has it: it expired while the question was open.
    let expired = false;
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
      expired = answered?.ok === false && answered.error.kind === EXPIRED_KIND;
    }
    setBusy(false);
    arrivedAt.current.delete(request.requestId);
    // The question goes either way (the request is taken), so the outcome is a notice.
    if (!ok && allow) {
      uiStateStore.setState((state) =>
        showNotice(
          state,
          expired ? "aiImageRequestExpired" : "aiImageRequestFailed",
        ),
      );
    }
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
