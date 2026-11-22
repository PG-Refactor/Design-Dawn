import { useEffect, useId, useState } from "react";
import type {
  GitConflictSide,
  GitConflictVersions,
} from "../../application/ports/git-gateway";
import { Modal } from "../workspace/modal";
import { useMessages } from "../workspace/use-messages";
import { useWorkspaceServices } from "../workspace/workspace-services-context";
import { GitConflictImageChoice } from "./git-conflict-images";
import "./git-conflict-dialog.css";

// Resolving one conflicted file: both versions side by side, the Block-by-Block merge of a
// sheet.json when it worked, and an editable text that becomes the file (then staged).
export function GitConflictDialog({
  path,
  onClose,
}: {
  readonly path: string;
  readonly onClose: () => void;
}) {
  const texts = useMessages().git.conflict;
  const { gitController } = useWorkspaceServices();
  const titleId = useId();
  const descriptionId = useId();
  const editId = useId();
  const [versions, setVersions] = useState<GitConflictVersions | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void gitController.conflictVersions(path).then((read) => {
      if (!current) return;
      if (!read.ok) {
        setFailed(true);
        return;
      }
      setVersions(read.value);
      setText(read.value.merged ?? read.value.current ?? read.value.ours ?? "");
    });
    return () => {
      current = false;
    };
  }, [gitController, path]);

  async function resolve(content: string): Promise<void> {
    setBusy(true);
    const resolved = await gitController.resolveConflict(path, content);
    setBusy(false);
    if (resolved.ok) onClose();
  }

  async function resolveWithSide(side: GitConflictSide): Promise<void> {
    setBusy(true);
    const resolved = await gitController.resolveConflictWithSide(path, side);
    setBusy(false);
    if (resolved.ok) onClose();
  }

  const images = versions?.images ?? null;

  return (
    <Modal
      titleId={titleId}
      descriptionId={descriptionId}
      onCancel={onClose}
      busy={busy}
      wide
    >
      <h2 id={titleId} className="modal__title">
        {texts.title(path)}
      </h2>
      <div className="modal__body git-conflict">
        <p id={descriptionId}>
          {images === null ? texts.description : texts.imageDescription}
        </p>
        {versions === null && !failed && <p role="status">{texts.loading}</p>}
        {failed && <p role="alert">{texts.loadFailed}</p>}
        {images !== null && (
          <GitConflictImageChoice
            images={images}
            busy={busy}
            onChoose={(side) => void resolveWithSide(side)}
          />
        )}
        {versions !== null && images === null && (
          <>
            {versions.merged !== null && (
              <p className="git-conflict__merged">
                {texts.merged}{" "}
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => void resolve(versions.merged ?? "")}
                >
                  {texts.useMerged}
                </button>
              </p>
            )}
            {versions.conflictingBlocks.length > 0 && (
              <p>
                {texts.conflictingBlocks(versions.conflictingBlocks.length)}
              </p>
            )}
            <div className="git-conflict__sides">
              {(
                [
                  [texts.ours, versions.ours, texts.useOurs],
                  [texts.theirs, versions.theirs, texts.useTheirs],
                ] as const
              ).map(([label, side, use]) => (
                <figure key={label} className="git-conflict__side">
                  <figcaption>{label}</figcaption>
                  <pre>{side ?? texts.none}</pre>
                  <button
                    type="button"
                    className="button"
                    disabled={busy || side === null}
                    onClick={() => setText(side ?? "")}
                  >
                    {use}
                  </button>
                </figure>
              ))}
            </div>
            <label htmlFor={editId} className="git-conflict__edit-label">
              {texts.editLabel}
            </label>
            <textarea
              id={editId}
              className="git-conflict__edit"
              spellCheck={false}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </>
        )}
      </div>
      <div className="modal__actions">
        {images === null ? (
          <button
            type="button"
            className="button button--primary"
            disabled={busy || versions === null}
            onClick={() => void resolve(text)}
          >
            {texts.resolve}
          </button>
        ) : null}
        <button
          type="button"
          className="button"
          onClick={onClose}
          disabled={busy}
        >
          {texts.cancel}
        </button>
      </div>
    </Modal>
  );
}
