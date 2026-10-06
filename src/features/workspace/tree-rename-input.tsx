import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { parseDisplayName } from "../../domain/shared/display-name";
import { describeInvalidName } from "./workspace-messages";

export interface TreeRenameInputProps {
  readonly initialName: string;
  readonly label: string;
  // Called with a name that passed the domain validation (changed or not: the action
  // decides that an unchanged name is not a command).
  readonly onSubmit: (name: string) => void;
  readonly onCancel: () => void;
  // Puts focus back on the tree item the input belongs to.
  readonly restoreFocus: () => void;
}

const KEYS = { enter: "Enter", escape: "Escape" } as const;

// The inline name editor of a tree row. The draft is local; the application is only
// told once, on Enter. Every key event is kept inside the input (stopPropagation), so the
// tree's own shortcuts (F2, Ctrl+Arrow, Ctrl+Z, arrow navigation) and any shortcut above
// it never see typing; native text editing and its own Ctrl+Z stay in charge.
export function TreeRenameInput({
  initialName,
  label,
  onSubmit,
  onCancel,
  restoreFocus,
}: TreeRenameInputProps) {
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // Set once Enter / Escape ended the edit, so the blur caused by moving focus away does
  // not report a second ending.
  const finished = useRef(false);
  const [draft, setDraft] = useState(initialName);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function finish(end: () => void): void {
    finished.current = true;
    restoreFocus();
    end();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    event.stopPropagation();
    // An IME composition uses Enter / Escape to choose and cancel candidates.
    if (event.nativeEvent.isComposing) return;
    if (event.key === KEYS.escape) {
      event.preventDefault();
      finish(onCancel);
      return;
    }
    if (event.key !== KEYS.enter) return;
    event.preventDefault();
    if (!parseDisplayName(draft).ok) {
      setErrorMessage(describeInvalidName(draft));
      return;
    }
    finish(() => onSubmit(draft));
  }

  return (
    <span className="tree-rename">
      <input
        ref={inputRef}
        type="text"
        className="tree-rename__input"
        value={draft}
        aria-label={label}
        aria-invalid={errorMessage !== null}
        aria-describedby={errorMessage === null ? undefined : errorId}
        autoComplete="off"
        onChange={(event) => {
          setDraft(event.target.value);
          setErrorMessage(null);
        }}
        onKeyDown={handleKeyDown}
        // Leaving the input by other means (a click elsewhere, Tab) cancels: a rename that
        // was never confirmed with Enter must not be saved silently.
        onBlur={() => {
          if (!finished.current) onCancel();
        }}
      />
      {errorMessage === null ? null : (
        <span id={errorId} role="alert" className="tree-rename__error">
          {errorMessage}
        </span>
      )}
    </span>
  );
}
