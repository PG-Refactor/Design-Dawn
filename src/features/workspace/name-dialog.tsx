import { type FormEvent, useId, useRef, useState } from "react";
import { parseDisplayName } from "../../domain/shared/display-name";
import { Modal } from "./modal";
import { describeInvalidName, MESSAGES } from "./workspace-messages";
import "./name-dialog.css";

export interface NameDialogProps {
  readonly title: string;
  readonly nameLabel: string;
  readonly submitLabel: string;
  // Called only with a name that passed the domain validation.
  readonly onSubmit: (name: string) => void;
  readonly onCancel: () => void;
  readonly busy: boolean;
}

// Asks for a display name. Validation uses the domain parser, so the dialog can never
// accept something the workspace would refuse for the same reason.
export function NameDialog({
  title,
  nameLabel,
  submitLabel,
  onSubmit,
  onCancel,
  busy,
}: NameDialogProps) {
  const titleId = useId();
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy) return;
    if (!parseDisplayName(name).ok) {
      setErrorMessage(describeInvalidName(name));
      inputRef.current?.focus();
      return;
    }
    setErrorMessage(null);
    onSubmit(name);
  }

  return (
    <Modal
      titleId={titleId}
      onCancel={onCancel}
      initialFocusRef={inputRef}
      busy={busy}
    >
      <h2 id={titleId} className="modal__title">
        {title}
      </h2>
      <form onSubmit={handleSubmit} noValidate>
        <div className="name-dialog__field">
          <label htmlFor={inputId} className="name-dialog__label">
            {nameLabel}
          </label>
          <input
            id={inputId}
            ref={inputRef}
            className="name-dialog__input"
            type="text"
            value={name}
            disabled={busy}
            autoComplete="off"
            aria-invalid={errorMessage !== null}
            aria-describedby={errorMessage === null ? undefined : errorId}
            onChange={(event) => setName(event.target.value)}
          />
          {/* An alert is announced when it appears, which is the point of showing it inline. */}
          {errorMessage === null ? null : (
            <p id={errorId} role="alert" className="name-dialog__error">
              {errorMessage}
            </p>
          )}
        </div>
        <div className="modal__actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={onCancel}
          >
            {MESSAGES.dialogs.cancel}
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={busy}
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
