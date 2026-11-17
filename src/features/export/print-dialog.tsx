import { useId, useRef, useState } from "react";
import type { DocumentId, SheetId } from "../../domain/shared/entity-id";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { useMermaidRenderer } from "../mermaid/mermaid-renderer-context";
import { Modal } from "../workspace/modal";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import type { ExportLayout } from "./export-html";
import { PaperFields } from "./paper-fields";
import { measurePrintPage } from "./print-frame";
import "./print-dialog.css";

export interface PrintTarget {
  readonly documentId: DocumentId;
  readonly documentName: string;
  readonly sheetId: SheetId;
  readonly sheetName: string;
  // Every loaded sheet of the Document, in its order.
  readonly sheetIds: readonly SheetId[];
}

type Scope = "sheet" | "document";

type Status =
  | { readonly kind: "editing" }
  // Something in the Document is not saved: save first, or print as it is?
  | { readonly kind: "unsaved" }
  | { readonly kind: "preparing" }
  // The page is ready but some blocks are cut off; printing needs a second confirmation.
  | {
      readonly kind: "warning";
      readonly page: string;
      readonly title: string;
      readonly overflowing: number;
    };

// "Print / Save as PDF…": what to print and how to cut it into pages, then the system
// print dialog (where a PDF printer is chosen).
export function PrintDialog({
  target,
  onClose,
}: {
  readonly target: PrintTarget;
  readonly onClose: () => void;
}) {
  const messages = useMessages().export;
  const { exportActions, actions } = useWorkspaceServices();
  const renderer = useMermaidRenderer();
  const titleId = useId();
  const descriptionId = useId();
  const printRef = useRef<HTMLButtonElement>(null);
  const [scope, setScope] = useState<Scope>("sheet");
  // The choices are kept for the next print and shown at once by the canvas page breaks.
  const settings = useStoreSelector(
    exportActions.printSettings,
    (state) => state,
  );
  const { mode } = settings;
  const { size: paperSize, orientation, scale } = settings.paper;
  const [status, setStatus] = useState<Status>({ kind: "editing" });
  const [notice, setNotice] = useState<string | null>(null);

  function layout(): ExportLayout {
    return mode === "fit"
      ? { kind: "fit" }
      : { kind: "paper", size: paperSize, orientation, scale };
  }

  function close(): void {
    onClose();
  }

  // The print shows what the app holds; still, unsaved changes are offered to be saved
  // first, so what is printed is also what is on disk.
  function requestPrint(): void {
    if (actions.hasUnsavedChanges([target.documentId])) {
      setStatus({ kind: "unsaved" });
      return;
    }
    void prepareAndPrint();
  }

  async function saveAndPrint(): Promise<void> {
    setStatus({ kind: "preparing" });
    const saved = await actions.saveAll();
    if (!saved.ok) {
      setStatus({ kind: "editing" });
      return;
    }
    await prepareAndPrint();
  }

  async function openPrint(title: string, page: string): Promise<void> {
    const opened = await exportActions.openPrintWindow(title, page);
    if (opened.ok) onClose();
    else setStatus({ kind: "editing" });
  }

  async function prepareAndPrint(): Promise<void> {
    setNotice(null);
    setStatus({ kind: "preparing" });
    const sheetIds = scope === "sheet" ? [target.sheetId] : target.sheetIds;
    const title =
      scope === "sheet"
        ? `${target.documentName} - ${target.sheetName}`
        : target.documentName;
    const page = await exportActions.buildPrintPage({
      renderer,
      documentId: target.documentId,
      sheetIds,
      title,
      layout: layout(),
    });
    if (!page.ok) {
      setStatus({ kind: "editing" });
      return;
    }
    const measured = await measurePrintPage(page.value);
    if (measured.blocks === 0) {
      setNotice(messages.emptyWarning);
      setStatus({ kind: "editing" });
      return;
    }
    if (measured.overflowing > 0) {
      setStatus({
        kind: "warning",
        page: page.value,
        title,
        overflowing: measured.overflowing,
      });
      return;
    }
    await openPrint(title, page.value);
  }

  function printAnyway(): void {
    if (status.kind !== "warning") return;
    void openPrint(status.title, status.page);
  }

  const busy = status.kind === "preparing";
  return (
    <Modal
      titleId={titleId}
      descriptionId={descriptionId}
      onCancel={close}
      initialFocusRef={printRef}
      busy={busy}
    >
      <h2 id={titleId} className="modal__title">
        {messages.printTitle}
      </h2>
      <div className="modal__body print-dialog">
        <p id={descriptionId}>{messages.printDescription}</p>
        <fieldset className="print-dialog__group" disabled={busy}>
          <legend>{messages.target}</legend>
          <label>
            <input
              type="radio"
              name="print-scope"
              checked={scope === "sheet"}
              onChange={() => setScope("sheet")}
            />
            {messages.targetSheet}
          </label>
          <label>
            <input
              type="radio"
              name="print-scope"
              checked={scope === "document"}
              onChange={() => setScope("document")}
            />
            {messages.targetDocument}
          </label>
        </fieldset>
        <PaperFields
          disabled={busy}
          fitLabel={messages.modeFit}
          paperLabel={messages.modePaper}
          note={messages.printPaperNote}
        />
        {notice !== null && <p role="status">{notice}</p>}
        {status.kind === "warning" && (
          <p role="alert" className="print-dialog__warning">
            {messages.overflowWarning(status.overflowing)}
          </p>
        )}
        {status.kind === "unsaved" && (
          <p role="alert" className="print-dialog__warning">
            {messages.unsavedBeforePrint}
          </p>
        )}
      </div>
      <div className="modal__actions">
        <button
          type="button"
          className="button"
          onClick={close}
          disabled={busy}
        >
          {messages.cancel}
        </button>
        {status.kind === "warning" ? (
          <button
            type="button"
            className="button button--primary"
            onClick={printAnyway}
          >
            {messages.printAnyway}
          </button>
        ) : status.kind === "unsaved" ? (
          <>
            <button
              type="button"
              className="button"
              onClick={() => void prepareAndPrint()}
            >
              {messages.printWithoutSaving}
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void saveAndPrint()}
            >
              {messages.saveAndPrint}
            </button>
          </>
        ) : (
          <button
            ref={printRef}
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={requestPrint}
          >
            {busy ? messages.preparing : messages.printButton}
          </button>
        )}
      </div>
    </Modal>
  );
}
