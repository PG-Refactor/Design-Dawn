import { useId, useRef } from "react";
import { Modal } from "./modal";

export interface ConfirmDialogProps {
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly cancelLabel: string;
  readonly confirmLabel: string;
  // Destructive by default; a plain confirmation (save and move) uses the primary look.
  readonly confirmVariant?: "danger" | "primary";
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly busy: boolean;
}

// For destructive actions: the default focus is on cancel, so Enter right after the
// dialog opens never deletes anything.
export function ConfirmDialog({
  title,
  paragraphs,
  cancelLabel,
  confirmLabel,
  confirmVariant = "danger",
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
