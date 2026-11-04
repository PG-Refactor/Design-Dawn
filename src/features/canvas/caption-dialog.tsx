import { type FormEvent, useId, useRef, useState } from "react";
import { parseCaption } from "../../domain/block/caption";
import { Modal } from "../workspace/modal";
import { useMessages } from "../workspace/use-messages";
import "../workspace/name-dialog.css";

export interface CaptionDialogProps {
  // The caption the figure has now ("" when none).
  readonly initial: string;
  // Called with the trimmed text ("" = remove), which the domain accepts.
  readonly onSubmit: (text: string) => void;
  readonly onCancel: () => void;
}

// Asks for a figure's caption. Validated with the domain parser, like a name, so the
// dialog never accepts what the action would refuse.
export function CaptionDialog({
  initial,
  onSubmit,
  onCancel,
}: CaptionDialogProps) {
  const messages = useMessages().canvas.caption;
  const cancelLabel = useMessages().workspace.dialogs.cancel;
  const titleId = useId();
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initial);
  const [invalid, setInvalid] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed !== "" && !parseCaption(trimmed).ok) {
      setInvalid(true);
      inputRef.current?.focus();
      return;
    }
    onSubmit(trimmed);
  }

  return (
    <Modal
      titleId={titleId}
      onCancel={onCancel}
      initialFocusRef={inputRef}
      busy={false}
    >
      <h2 id={titleId} className="modal__title">
        {messages.dialogTitle}
      </h2>
      <form onSubmit={handleSubmit} noValidate>
        <div className="name-dialog__field">
          <label htmlFor={inputId} className="name-dialog__label">
            {messages.fieldLabel}
          </label>
          <input
            id={inputId}
            ref={inputRef}
            className="name-dialog__input"
            type="text"
            value={text}
            autoComplete="off"
            aria-invalid={invalid}
            aria-describedby={invalid ? `${hintId} ${errorId}` : hintId}
            onChange={(event) => setText(event.target.value)}
          />
          <p id={hintId} className="name-dialog__hint">
            {messages.hint}
          </p>
          {invalid ? (
            <p id={errorId} role="alert" className="name-dialog__error">
              {messages.invalid}
            </p>
          ) : null}
        </div>
        <div className="modal__actions">
          <button type="button" className="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="submit" className="button button--primary">
            {messages.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
