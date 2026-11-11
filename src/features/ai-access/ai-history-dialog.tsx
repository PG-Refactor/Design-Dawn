import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { AiHistoryEntry } from "../../application/ports/ai-access-gateway";
import type { ApplicationState } from "../../application/state/application-state";
import { parseDocumentId, parseSheetId } from "../../domain/shared/entity-id";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { Modal } from "../workspace/modal";
import { useDisplayLanguage, useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { canRevert, revertAiChange } from "./ai-history-revert";
import "./ai-access-dialog.css";

const MILLISECONDS_PER_SECOND = 1000;

const selectProject = (application: ApplicationState) => application.project;

// "AI Change History…": what AI tools changed in the open Project, read from the app's
// settings, with an undo for a text change that nobody has changed since.
export function AiHistoryDialog({ onClose }: { readonly onClose: () => void }) {
  const texts = useMessages().aiAccess.history;
  const language = useDisplayLanguage();
  const { aiAccess, applicationStore, actions, canvasActions } =
    useWorkspaceServices();
  const project = useStoreSelector(applicationStore, selectProject);
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [entries, setEntries] = useState<readonly AiHistoryEntry[] | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (project === null) return;
    const read = await aiAccess.history(project.projectId);
    setFailed(!read.ok);
    setEntries(read.ok ? read.value : []);
  }, [aiAccess, project]);

  useEffect(() => {
    void load();
  }, [load]);

  function where(entry: AiHistoryEntry): string {
    const documentId = parseDocumentId(entry.documentId ?? "");
    const sheetId = parseSheetId(entry.sheetId ?? "");
    const documentName = documentId.ok
      ? project?.documents.find(
          (candidate) => candidate.documentId === documentId.value,
        )?.name
      : undefined;
    const sheetName =
      documentId.ok && sheetId.ok
        ? applicationStore
            .getState()
            .documents.get(documentId.value)
            ?.sheets.get(sheetId.value)?.name
        : undefined;
    return texts.where(
      documentName ?? entry.documentId ?? "",
      sheetName ?? entry.sheetId ?? "",
    );
  }

  async function revert(entry: AiHistoryEntry): Promise<void> {
    const result = await revertAiChange(
      { applicationStore, actions, canvasActions },
      entry,
    );
    setNotice(
      result.ok
        ? texts.reverted
        : result.error.kind === "staleContent"
          ? texts.changedSince
          : result.error.detail,
    );
  }

  const time = new Intl.DateTimeFormat(language, {
    dateStyle: "short",
    timeStyle: "short",
  });

  return (
    <Modal
      titleId={titleId}
      descriptionId={descriptionId}
      onCancel={onClose}
      initialFocusRef={closeRef}
      wide
    >
      <h2 id={titleId} className="modal__title">
        {texts.title}
      </h2>
      <div className="modal__body">
        <p id={descriptionId}>{texts.description}</p>
        {notice !== null && <p role="status">{notice}</p>}
        {failed && <p role="alert">{texts.loadFailed}</p>}
        {entries !== null && entries.length === 0 && !failed && (
          <p>{texts.empty}</p>
        )}
        <ul className="ai-history__list">
          {(entries ?? []).map((entry, index) => (
            <li
              // Entries have no id; the list is read once per opening and not reordered.
              // biome-ignore lint/suspicious/noArrayIndexKey: entries have no identity of their own.
              key={index}
              className="ai-history__entry"
            >
              <div className="ai-history__summary">
                <span>{time.format(entry.at * MILLISECONDS_PER_SECOND)}</span>
                <code>{entry.tool}</code>
                {entry.documentId !== null && <span>{where(entry)}</span>}
                {canRevert(entry) && (
                  <button
                    type="button"
                    className="button"
                    onClick={() => void revert(entry)}
                  >
                    {texts.revert}
                  </button>
                )}
              </div>
              {(entry.before !== null || entry.after !== null) && (
                <details>
                  <summary>
                    {texts.before} / {texts.after}
                  </summary>
                  <div className="ai-history__texts">
                    <figure>
                      <figcaption>{texts.before}</figcaption>
                      <pre>{entry.before ?? ""}</pre>
                    </figure>
                    <figure>
                      <figcaption>{texts.after}</figcaption>
                      <pre>{entry.after ?? ""}</pre>
                    </figure>
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
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
