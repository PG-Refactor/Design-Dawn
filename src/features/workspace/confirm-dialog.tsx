import { useId, useRef } from "react";
import { Modal } from "./modal";

// A third choice between cancel and confirm (e.g. "close without saving"); always
// destructive-looking, because it is the answer that gives something up.
export interface ConfirmDialogAlternative {
  readonly label: string;
  readonly onSelect: () => void;
}

export interface ConfirmDialogProps {
  readonly title: string;
  readonly paragraphs: readonly string[];
  // Shown as a list after the paragraphs (e.g. the names of affected Documents).
  readonly listItems?: readonly string[];
  readonly cancelLabel: string;
  readonly confirmLabel: string;
  // Destructive by default; a plain confirmation (save and move) uses the primary look.
  readonly confirmVariant?: "danger" | "primary";
  readonly alternative?: ConfirmDialogAlternative;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly busy: boolean;
}

// For destructive actions: the default focus is on cancel, so Enter right after the
// dialog opens never deletes anything.
export function ConfirmDialog({
  title,
  paragraphs,
  listItems = [],
  cancelLabel,
  confirmLabel,
  confirmVariant = "danger",
  alternative,
  onCancel,
  onConfirm,
  busy,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal
      titleId={titleId}
      descriptionId={descriptionId}
      onCancel={onCancel}
      initialFocusRef={cancelRef}
      busy={busy}
    >
      <h2 id={titleId} className="modal__title">
        {title}
      </h2>
      <div id={descriptionId} className="modal__body">
        {paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        {listItems.length === 0 ? null : (
          <ul>
            {listItems.map((item, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: names may repeat, the list is static
              <li key={`${index}:${item}`}>{item}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="modal__actions">
        <button
          ref={cancelRef}
          type="button"
          className="button"
          disabled={busy}
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        {alternative === undefined ? null : (
          <button
            type="button"
            className="button button--danger"
            disabled={busy}
            onClick={alternative.onSelect}
          >
            {alternative.label}
          </button>
        )}
        <button
          type="button"
          className={`button button--${confirmVariant}`}
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
