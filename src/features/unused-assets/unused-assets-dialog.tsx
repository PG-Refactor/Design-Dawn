import { useEffect, useId, useRef, useState } from "react";
import type { UnusedAssets } from "../../application/ports/asset-types";
import { parseContentPath } from "../../domain/block/content-path";
import type { DocumentId } from "../../domain/shared/entity-id";
import { createStore } from "../../shared/store/store";
import { useStoreSelector } from "../../shared/store/use-store-selector";
import { Modal } from "../workspace/modal";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import "./unused-assets-dialog.css";

const BYTES_PER_KILOBYTE = 1024;

// The Document whose unused images the dialog shows; null while it is closed.
const request = createStore<{ readonly documentId: DocumentId | null }>({
  documentId: null,
});

export function openUnusedAssets(documentId: DocumentId): void {
  request.setState(() => ({ documentId }));
}

function closeUnusedAssets(): void {
  request.setState(() => ({ documentId: null }));
}

export function UnusedAssetsDialog() {
  const documentId = useStoreSelector(request, (state) => state.documentId);
  // The request belongs to this window's shell: it does not outlive it.
  useEffect(() => closeUnusedAssets, []);
  if (documentId === null) return null;
  return <UnusedAssetsBody key={documentId} documentId={documentId} />;
}

type Status =
  | { readonly kind: "unsaved" }
  | { readonly kind: "finding" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "list"; readonly found: UnusedAssets }
  | { readonly kind: "deleting"; readonly found: UnusedAssets }
  | {
      readonly kind: "done";
      readonly deleted: number;
      readonly kept: number;
    };

// Looks for the images of the Document that nothing uses and deletes the chosen ones, after
// saving: what is not on disk yet would otherwise look unused.
function UnusedAssetsBody({ documentId }: { readonly documentId: DocumentId }) {
  const messages = useMessages().unusedAssets;
  const { actions, applicationStore, assetUrlResolver } =
    useWorkspaceServices();
  const titleId = useId();
  const documentName = useStoreSelector(
    applicationStore,
    (state) =>
      state.project?.documents.find((entry) => entry.documentId === documentId)
        ?.name ?? "",
  );
  const projectId = useStoreSelector(
    applicationStore,
    (state) => state.project?.projectId ?? null,
  );
  const [status, setStatus] = useState<Status>(() =>
    actions.hasUnsavedChanges([documentId])
      ? { kind: "unsaved" }
      : { kind: "finding" },
  );
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const primaryRef = useRef<HTMLButtonElement>(null);
  const busy = status.kind === "finding" || status.kind === "deleting";

  async function find(): Promise<void> {
    setStatus({ kind: "finding" });
    const found = await actions.listUnusedAssets(documentId);
    if (!found.ok) {
      setStatus({ kind: "failed", message: messages.failed });
      return;
    }
    setChosen(new Set(found.value.assets.map((asset) => asset.contentPath)));
    setStatus({ kind: "list", found: found.value });
  }

  async function saveAndFind(): Promise<void> {
    setStatus({ kind: "finding" });
    const saved = await actions.saveAll();
    if (!saved.ok) {
      setStatus({ kind: "unsaved" });
      return;
    }
    await find();
  }

  // Started once: an unsaved Document waits for "Save and Look".
  const started = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once for the dialog.
  useEffect(() => {
    if (started.current || status.kind !== "finding") return;
    started.current = true;
    void find();
  }, []);

  async function deleteChosen(found: UnusedAssets): Promise<void> {
    const paths = found.assets
      .map((asset) => asset.contentPath)
      .filter((path) => chosen.has(path));
    setStatus({ kind: "deleting", found });
    const removed = await actions.deleteUnusedAssets(documentId, paths);
    if (!removed.ok) {
      setStatus({ kind: "failed", message: messages.deleteFailed });
      return;
    }
    setStatus({
      kind: "done",
      deleted: removed.value.length,
      kept: paths.length - removed.value.length,
    });
  }

  function toggle(path: string): void {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function thumbnail(path: string): string | null {
    const contentPath = parseContentPath(path);
    if (!contentPath.ok || projectId === null) return null;
    return assetUrlResolver.urlFor(projectId, documentId, contentPath.value);
  }

  const found =
    status.kind === "list" || status.kind === "deleting" ? status.found : null;

  return (
    <Modal
      titleId={titleId}
      onCancel={closeUnusedAssets}
      initialFocusRef={primaryRef}
      busy={busy}
      wide
    >
      <h2 id={titleId} className="modal__title">
        {messages.title(documentName)}
      </h2>
      <div className="modal__body unused-assets">
        {status.kind === "unsaved" && <p>{messages.unsaved}</p>}
        {status.kind === "finding" && <p role="status">{messages.finding}</p>}
        {status.kind === "failed" && <p role="alert">{status.message}</p>}
        {status.kind === "done" && (
          <p role="status">
            {messages.deleted(status.deleted)}
            {status.kept > 0 && ` ${messages.keptInUse(status.kept)}`}
          </p>
        )}
        {found !== null && found.assets.length === 0 && (
          <p role="status">{messages.none}</p>
        )}
        {found !== null && found.assets.length > 0 && (
          <>
            <p>{messages.description}</p>
            <div className="unused-assets__bulk">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() =>
                  setChosen(
                    new Set(found.assets.map((asset) => asset.contentPath)),
                  )
                }
              >
                {messages.selectAll}
              </button>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => setChosen(new Set())}
              >
                {messages.deselectAll}
              </button>
            </div>
            <ul className="unused-assets__list" aria-label={messages.listLabel}>
              {found.assets.map((asset) => {
                const url = thumbnail(asset.contentPath);
                return (
                  <li key={asset.contentPath} className="unused-assets__item">
                    <label>
                      <input
                        type="checkbox"
                        checked={chosen.has(asset.contentPath)}
                        disabled={busy}
                        onChange={() => toggle(asset.contentPath)}
                      />
                      {url === null ? (
                        <span className="unused-assets__thumbnail" />
                      ) : (
                        <img
                          className="unused-assets__thumbnail"
                          src={url}
                          alt=""
                        />
                      )}
                      <span className="unused-assets__name">
                        {asset.contentPath}
                      </span>
                      <span className="unused-assets__size">
                        {messages.size(
                          (asset.size / BYTES_PER_KILOBYTE).toFixed(1),
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {found !== null && found.heldByHistory > 0 && (
          <p className="unused-assets__note">
            {messages.heldByHistory(found.heldByHistory)}
          </p>
        )}
      </div>
      <div className="modal__actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={closeUnusedAssets}
        >
          {status.kind === "list" && found !== null && found.assets.length > 0
            ? messages.cancel
            : messages.close}
        </button>
        {status.kind === "unsaved" && (
          <button
            ref={primaryRef}
            type="button"
            className="button button--primary"
            onClick={() => void saveAndFind()}
          >
            {messages.saveAndFind}
          </button>
        )}
        {found !== null && found.assets.length > 0 && (
          <button
            ref={primaryRef}
            type="button"
            className="button button--primary"
            disabled={busy || chosen.size === 0}
            onClick={() => void deleteChosen(found)}
          >
            {status.kind === "deleting"
              ? messages.deleting
              : messages.deleteChosen(chosen.size)}
          </button>
        )}
      </div>
    </Modal>
  );
}
