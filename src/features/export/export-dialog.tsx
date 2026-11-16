import { useId, useMemo, useRef, useState } from "react";
import type { ExportFolderFormat } from "../../application/ports/asset-types";
import type { DocumentId, SheetId } from "../../domain/shared/entity-id";
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
import type { ExportDialogRequest, ExportScope } from "./export-dialog-store";
import { type ExportTreeNode, exportTree } from "./export-tree";
import "./print-dialog.css";

// The shown Document and sheet, with their names (the first two scopes).
export interface ShownTarget {
  readonly documentId: DocumentId;
  readonly documentName: string;
  readonly sheet: { readonly sheetId: SheetId; readonly name: string } | null;
}

interface Folder {
  readonly token: string;
  readonly folderName: string;
}

type Status =
  | { readonly kind: "choosing" }
  | { readonly kind: "working" }
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
    }
  | { readonly kind: "saved"; readonly fileName: string };

// "Export ▸ Markdown / HTML / PDF…": what to write in the format chosen in the menu (the
// shown sheet, the shown Document, or Documents chosen in the Project's tree, a folder
// ticking everything inside).
// One file goes where the save dialog says; several go into a chosen folder, one file per
// Document, in folders like the Project's when asked. Rust shows the dialogs and writes.
export function ExportDialog({
  request,
  shown,
  onClose,
}: {
  readonly request: ExportDialogRequest;
  readonly shown: ShownTarget | null;
  readonly onClose: () => void;
}) {
  const allMessages = useMessages();
  const messages = allMessages.export;
  const { exportActions, applicationStore } = useWorkspaceServices();
  const renderer = useMermaidRenderer();
  const titleId = useId();
  const startRef = useRef<HTMLButtonElement>(null);
  const project = useStoreSelector(applicationStore, (state) => state.project);
  const tree = useMemo<ExportTreeNode[]>(
    () => (project === null ? [] : exportTree(project)),
    [project],
  );
  const documents = useMemo(
    () =>
      tree.flatMap((node): DocumentToExport[] =>
        node.kind === "document"
          ? [
              {
                documentId: node.documentId,
                name: node.name,
                folders: node.folders,
              },
            ]
          : [],
      ),
    [tree],
  );
  const [scope, setScope] = useState<ExportScope>(() =>
    request.scope !== "choose" && shown === null ? "choose" : request.scope,
  );
  const [chosen, setChosen] = useState<ReadonlySet<DocumentId>>(
    () =>
      new Set(
        request.documentIds ?? documents.map((entry) => entry.documentId),
      ),
  );
  const { format } = request;
  const [keepFolders, setKeepFolders] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: "choosing" });
  const busy = status.kind === "working" || status.kind === "exporting";
  const selected = documents.filter((entry) => chosen.has(entry.documentId));
  const hasFolders = tree.some((node) => node.kind === "folder");
  const formatTitle: Record<ExportFolderFormat, string> = {
    md: messages.exportMarkdownTitle,
    html: messages.exportHtmlTitle,
    pdf: messages.exportPdfTitle,
  };

  function setMany(ids: readonly DocumentId[], on: boolean): void {
    setChosen((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function exportShown(): Promise<void> {
    if (shown === null) return;
    setStatus({ kind: "working" });
    const result = await exportActions.exportShown({
      renderer,
      format,
      documentId: shown.documentId,
      documentName: shown.documentName,
      ...(scope === "sheet" && shown.sheet !== null
        ? { sheet: shown.sheet }
        : {}),
    });
    if (result.ok && result.value.status === "saved") {
      setStatus({ kind: "saved", fileName: result.value.fileName });
    } else {
      setStatus({ kind: "choosing" });
    }
  }

  async function exportInto(folder: Folder): Promise<void> {
    setStatus({ kind: "exporting", done: 0, total: selected.length });
    const result = await exportActions.exportDocuments({
      renderer,
      documents: selected,
      format,
      folder: folder.token,
      keepFolders,
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
    setStatus({ kind: "working" });
    const folder = await exportActions.chooseExportFolder();
    if (!folder.ok || folder.value === null) {
      setStatus({ kind: "choosing" });
      return;
    }
    const existing = await exportActions.existingFiles(
      folder.value.token,
      folderFilesOf(selected, format, keepFolders),
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

  const choosing = status.kind === "choosing" || status.kind === "working";
  const canStart =
    !busy &&
    project !== null &&
    (scope === "choose"
      ? selected.length > 0
      : shown !== null && (scope === "document" || shown.sheet !== null));
  return (
    <Modal
      titleId={titleId}
      onCancel={onClose}
      initialFocusRef={startRef}
      busy={busy}
    >
      <h2 id={titleId} className="modal__title">
        {formatTitle[format]}
      </h2>
      <div className="modal__body print-dialog">
        {choosing && (
          <fieldset className="print-dialog__group" disabled={busy}>
            <legend>{messages.scopeLegend}</legend>
            <label>
              <input
                type="radio"
                name="export-scope"
                checked={scope === "sheet"}
                disabled={shown?.sheet === null || shown === null}
                onChange={() => setScope("sheet")}
              />
              {shown?.sheet === null || shown === null
                ? messages.scopeSheetNone
                : messages.scopeSheet(shown.documentName, shown.sheet.name)}
            </label>
            <label>
              <input
                type="radio"
                name="export-scope"
                checked={scope === "document"}
                disabled={shown === null}
                onChange={() => setScope("document")}
              />
              {shown === null
                ? messages.scopeDocumentNone
                : messages.scopeDocument(shown.documentName)}
            </label>
            <label>
              <input
                type="radio"
                name="export-scope"
                checked={scope === "choose"}
                onChange={() => setScope("choose")}
              />
              {messages.scopeChoose}
            </label>
            {scope === "choose" && (
              <div className="print-dialog__choose">
                <div className="print-dialog__row">
                  <button
                    type="button"
                    className="button"
                    onClick={() =>
                      setMany(
                        documents.map((entry) => entry.documentId),
                        true,
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
                <ul
                  className="print-dialog__documents"
                  aria-label={messages.documentsLegend}
                >
                  {tree.map((node) => {
                    const ids =
                      node.kind === "folder"
                        ? node.documentIds
                        : [node.documentId];
                    const ticked = ids.filter((id) => chosen.has(id)).length;
                    return (
                      <li
                        key={
                          node.kind === "folder"
                            ? node.folderId
                            : node.documentId
                        }
                        style={{
                          paddingLeft: `calc(${node.depth} * var(--space-3))`,
                        }}
                      >
                        <label
                          className={
                            node.kind === "folder"
                              ? "print-dialog__folder"
                              : undefined
                          }
                        >
                          <input
                            type="checkbox"
                            checked={ids.length > 0 && ticked === ids.length}
                            disabled={ids.length === 0}
                            ref={(element) => {
                              if (element !== null) {
                                element.indeterminate =
                                  ticked > 0 && ticked < ids.length;
                              }
                            }}
                            onChange={() => setMany(ids, ticked < ids.length)}
                          />
                          {node.kind === "folder"
                            ? messages.folderEntry(node.name)
                            : node.name}
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {hasFolders && (
                  <label>
                    <input
                      type="checkbox"
                      checked={keepFolders}
                      onChange={() => setKeepFolders(!keepFolders)}
                    />
                    {messages.keepFolders}
                  </label>
                )}
                {selected.length === 0 && (
                  <p role="status">{messages.noDocumentChosen}</p>
                )}
              </div>
            )}
          </fieldset>
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
        {status.kind === "saved" && (
          <p role="status">{messages.savedAs(status.fileName)}</p>
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
        ) : status.kind === "done" || status.kind === "saved" ? (
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
              disabled={!canStart}
              onClick={() =>
                void (scope === "choose"
                  ? chooseFolderAndExport()
                  : exportShown())
              }
            >
              {scope === "choose" ? messages.chooseFolder : messages.exportFile}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
