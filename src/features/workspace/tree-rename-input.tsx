import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { parseDisplayName } from "../../domain/shared/display-name";
import { useMessages } from "./use-messages";
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
  // What leaving the input (a click elsewhere, Tab) does: a rename keeps the name typed,
  // as most editors do; a creation inside a dialog is dropped, as the click may be on the
  // dialog's Cancel.
  readonly onLeave: "submit" | "cancel";
}

const KEYS = { enter: "Enter", escape: "Escape" } as const;

// The inline name editor of a tree row. The draft is local; the application is only
// told once, on Enter (or as `onLeave` says, when the focus leaves the input). Every key event is kept inside the input (stopPropagation), so the
// tree's own shortcuts (F2, Ctrl+Arrow, Ctrl+Z, arrow navigation) and any shortcut above
// it never see typing; native text editing and its own Ctrl+Z stay in charge.
export function TreeRenameInput({
  initialName,
  label,
  onSubmit,
  onCancel,
  restoreFocus,
  onLeave,
}: TreeRenameInputProps) {
  const messages = useMessages().workspace;
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // Set once the edit ended, so the blur caused by moving focus away after Enter / Escape
  // does not report a second ending.
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
      setErrorMessage(describeInvalidName(messages, draft));
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
        // A name that cannot be used is dropped on leaving, as there is no input left to
        // show why. The focus stays where the user put it.
        onBlur={() => {
          if (finished.current) return;
          finished.current = true;
          if (onLeave === "submit" && parseDisplayName(draft).ok)
            onSubmit(draft);
          else onCancel();
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
