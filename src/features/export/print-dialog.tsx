import { useId, useRef, useState } from "react";
import {
  ORIENTATIONS,
  type Orientation,
  PAPER_SCALES,
  PAPER_SIZE_IDS,
  PAPER_SIZES,
  type PaperScale,
  type PaperSettings,
  type PaperSize,
} from "../../domain/print/paper";
import type { DocumentId, SheetId } from "../../domain/shared/entity-id";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { useMermaidRenderer } from "../mermaid/mermaid-renderer-context";
import { Modal } from "../workspace/modal";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import type { ExportLayout } from "./export-html";
import {
  discardFrame,
  type PreparedPrint,
  preparePrintFrame,
  printFrame,
} from "./print-frame";
import type { PrintMode } from "./print-settings";
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
  | { readonly kind: "preparing" }
  // The page is ready but some blocks are cut off; printing needs a second confirmation.
  | { readonly kind: "warning"; readonly prepared: PreparedPrint };

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
  const { exportActions } = useWorkspaceServices();
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
  const setMode = (next: PrintMode) =>
    exportActions.printSettings.setState((state) => ({ ...state, mode: next }));
  const setPaper = (change: Partial<PaperSettings>) =>
    exportActions.printSettings.setState((state) => ({
      ...state,
      paper: { ...state.paper, ...change },
    }));
  const setPaperSize = (size: PaperSize) => setPaper({ size });
  const setOrientation = (next: Orientation) => setPaper({ orientation: next });
  const setScale = (next: PaperScale) => setPaper({ scale: next });
  const [status, setStatus] = useState<Status>({ kind: "editing" });
  const [notice, setNotice] = useState<string | null>(null);

  function layout(): ExportLayout {
    return mode === "fit"
      ? { kind: "fit" }
      : { kind: "paper", size: paperSize, orientation, scale };
  }

  function close(): void {
    if (status.kind === "warning") discardFrame(status.prepared);
    onClose();
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
    const prepared = await preparePrintFrame(page.value);
    if (prepared.frame.contentDocument?.querySelector(".block") === null) {
      discardFrame(prepared);
      setNotice(messages.emptyWarning);
      setStatus({ kind: "editing" });
      return;
    }
    if (prepared.overflowing > 0) {
      setStatus({ kind: "warning", prepared });
      return;
    }
    printFrame(prepared);
    onClose();
  }

  function printAnyway(): void {
    if (status.kind !== "warning") return;
    printFrame(status.prepared);
    onClose();
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
        <fieldset className="print-dialog__group" disabled={busy}>
          <legend>{messages.mode}</legend>
          <label>
            <input
              type="radio"
              name="print-mode"
              checked={mode === "fit"}
              onChange={() => setMode("fit")}
            />
            {messages.modeFit}
          </label>
          <label>
            <input
              type="radio"
              name="print-mode"
              checked={mode === "paper"}
              onChange={() => setMode("paper")}
            />
            {messages.modePaper}
          </label>
          {mode === "paper" && (
            <p className="print-dialog__note">{messages.printPaperNote}</p>
          )}
          {mode === "paper" && (
            <div className="print-dialog__paper">
              <label>
                {messages.paperSize}
                <select
                  value={paperSize}
                  onChange={(event) => {
                    const next = PAPER_SIZE_IDS.find(
                      (size) => size === event.target.value,
                    );
                    if (next !== undefined) setPaperSize(next);
                  }}
                >
                  {PAPER_SIZE_IDS.map((size) => (
                    <option key={size} value={size}>
                      {PAPER_SIZES[size].name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {messages.orientation}
                <select
                  value={orientation}
                  onChange={(event) => {
                    const next = ORIENTATIONS.find(
                      (value) => value === event.target.value,
                    );
                    if (next !== undefined) setOrientation(next);
                  }}
                >
                  <option value="portrait">{messages.portrait}</option>
                  <option value="landscape">{messages.landscape}</option>
                </select>
              </label>
              <label>
                {messages.scale}
                <select
                  value={scale}
                  onChange={(event) => {
                    const next = PAPER_SCALES.find(
                      (value) => value === event.target.value,
                    );
                    if (next !== undefined) setScale(next);
                  }}
                >
                  <option value="actual">{messages.scaleActual}</option>
                  <option value="fitWidth">{messages.scaleFitWidth}</option>
                  <option value="fitPage">{messages.scaleFitPage}</option>
                </select>
              </label>
            </div>
          )}
        </fieldset>
        {notice !== null && <p role="status">{notice}</p>}
        {status.kind === "warning" && (
          <p role="alert" className="print-dialog__warning">
            {messages.overflowWarning(status.prepared.overflowing)}
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
        ) : (
          <button
            ref={printRef}
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => void prepareAndPrint()}
          >
            {busy ? messages.preparing : messages.printButton}
          </button>
        )}
      </div>
    </Modal>
  );
}
