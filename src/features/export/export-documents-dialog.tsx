import { useId, useRef, useState } from "react";
import type { ExportFolderFormat } from "../../application/ports/asset-types";
import type { ApplicationState } from "../../application/state/application-state";
import type { DocumentId } from "../../domain/shared/entity-id";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { useMermaidRenderer } from "../mermaid/mermaid-renderer-context";
import { Modal } from "../workspace/modal";
import { useMessages } from "../workspace/use-messages";
import { describeErrorKind } from "../workspace/workspace-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import {
  type DocumentsExportOutcome,
  type DocumentToExport,
  folderFilesOf,
} from "./export-actions";
import "./print-dialog.css";

const FORMATS: readonly ExportFolderFormat[] = ["md", "html", "pdf"];

interface Folder {
  readonly token: string;
  readonly folderName: string;
}

type Status =
  | { readonly kind: "choosing" }
  | { readonly kind: "picking" }
  // Some files are already in the folder: replace them?
  | {
      readonly kind: "confirmReplace";
      readonly folder: Folder;
      readonly existing: readonly string[];
    }
  | {
      readonly kind: "exporting";
      readonly done: number;
      readonly total: number;
    }
  | {
      readonly kind: "done";
      readonly folder: Folder;
      readonly outcome: DocumentsExportOutcome;
    };

// The Documents the Project lists with a name (one that failed to load has none), in the
// Project's order.
function documentsOf(application: ApplicationState): DocumentToExport[] {
  return (application.project?.documents ?? []).flatMap((entry) =>
    entry.name === null
      ? []
      : [{ documentId: entry.documentId, name: entry.name }],
  );
}

// "Export Documents…": several Documents into one folder, one file each, as Markdown, HTML
// or PDF. Rust shows the folder dialog and writes; existing files are replaced only after
// a confirmation.
export function ExportDocumentsDialog({
  onClose,
}: {
  readonly onClose: () => void;
}) {
  const allMessages = useMessages();
  const messages = allMessages.export;
  const { exportActions, applicationStore } = useWorkspaceServices();
  const renderer = useMermaidRenderer();
  const titleId = useId();
  const descriptionId = useId();
  const startRef = useRef<HTMLButtonElement>(null);
  const [documents] = useState(() => documentsOf(applicationStore.getState()));
  const hasProject = useStoreSelector(
    applicationStore,
    (state) => state.project !== null,
  );
  const [chosen, setChosen] = useState<ReadonlySet<DocumentId>>(
    () => new Set(documents.map((entry) => entry.documentId)),
  );
  const [format, setFormat] = useState<ExportFolderFormat>("md");
  const [status, setStatus] = useState<Status>({ kind: "choosing" });
  const busy = status.kind === "picking" || status.kind === "exporting";
  const selected = documents.filter((entry) => chosen.has(entry.documentId));
  const formatLabel: Record<ExportFolderFormat, string> = {
    md: messages.formatMarkdown,
    html: messages.formatHtml,
    pdf: messages.formatPdf,
  };

  function toggle(documentId: DocumentId): void {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  }

  async function exportInto(folder: Folder): Promise<void> {
    setStatus({ kind: "exporting", done: 0, total: selected.length });
    const result = await exportActions.exportDocuments({
      renderer,
      documents: selected,
      format,
      folder: folder.token,
      onProgress: (done, total) =>
        setStatus({ kind: "exporting", done, total }),
    });
    setStatus(
      result.ok
        ? { kind: "done", folder, outcome: result.value }
        : { kind: "choosing" },
    );
  }

  async function chooseFolderAndExport(): Promise<void> {
    setStatus({ kind: "picking" });
    const folder = await exportActions.chooseExportFolder();
    if (!folder.ok || folder.value === null) {
      setStatus({ kind: "choosing" });
      return;
    }
    const existing = await exportActions.existingFiles(
      folder.value.token,
      folderFilesOf(selected, format),
    );
    if (!existing.ok) {
      setStatus({ kind: "choosing" });
      return;
    }
    if (existing.value.length > 0) {
      setStatus({
        kind: "confirmReplace",
        folder: folder.value,
        existing: existing.value,
      });
      return;
    }
    await exportInto(folder.value);
  }

  return (
    <Modal
      titleId={titleId}
      descriptionId={descriptionId}
      onCancel={onClose}
      initialFocusRef={startRef}
      busy={busy}
    >
      <h2 id={titleId} className="modal__title">
        {messages.documentsTitle}
      </h2>
      <div className="modal__body print-dialog">
        <p id={descriptionId}>{messages.documentsDescription}</p>
        {(status.kind === "choosing" || status.kind === "picking") && (
          <>
            <fieldset className="print-dialog__group" disabled={busy}>
              <legend>{messages.documentsLegend}</legend>
              <div className="print-dialog__row">
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    setChosen(
                      new Set(documents.map((entry) => entry.documentId)),
                    )
                  }
                >
                  {messages.selectAll}
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => setChosen(new Set())}
                >
                  {messages.selectNone}
                </button>
              </div>
              <div className="print-dialog__documents">
                {documents.map((entry) => (
                  <label key={entry.documentId}>
                    <input
                      type="checkbox"
                      checked={chosen.has(entry.documentId)}
                      onChange={() => toggle(entry.documentId)}
                    />
                    {entry.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="print-dialog__group" disabled={busy}>
              <legend>{messages.formatLegend}</legend>
              {FORMATS.map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="export-documents-format"
                    checked={format === value}
                    onChange={() => setFormat(value)}
                  />
                  {formatLabel[value]}
                </label>
              ))}
            </fieldset>
            {selected.length === 0 && (
              <p role="status">{messages.noDocumentChosen}</p>
            )}
          </>
        )}
        {status.kind === "confirmReplace" && (
          <div role="alert">
            <p>{messages.replaceQuestion(status.folder.folderName)}</p>
            <ul className="print-dialog__files">
              {status.existing.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        )}
        {status.kind === "exporting" && (
          <p role="status">{messages.exporting(status.done, status.total)}</p>
        )}
        {status.kind === "done" && (
          <div role="status">
            <p>
              {messages.exported(
                status.outcome.written.length,
                status.folder.folderName,
              )}
            </p>
            {status.outcome.failed.length > 0 && (
              <>
                <p>{messages.notExported}</p>
                <ul className="print-dialog__files">
                  {status.outcome.failed.map((failure) => (
                    <li key={failure.name}>
                      {messages.failedItem(
                        failure.name,
                        failure.error === null
                          ? messages.nothingToExport
                          : describeErrorKind(
                              allMessages.workspace,
                              failure.error.kind,
                            ),
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
      <div className="modal__actions">
        {status.kind === "confirmReplace" ? (
          <>
            <button
              type="button"
              className="button"
              onClick={() => setStatus({ kind: "choosing" })}
            >
              {messages.back}
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => void exportInto(status.folder)}
            >
              {messages.replaceAndExport}
            </button>
          </>
        ) : status.kind === "done" ? (
          <button
            type="button"
            className="button button--primary"
            onClick={onClose}
          >
            {messages.close}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="button"
              onClick={onClose}
              disabled={busy}
            >
              {messages.cancel}
            </button>
            <button
              ref={startRef}
              type="button"
              className="button button--primary"
              disabled={busy || selected.length === 0 || !hasProject}
              onClick={() => void chooseFolderAndExport()}
            >
              {messages.chooseFolder}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
