import { type KeyboardEvent, type Ref, useId } from "react";
import type { GuiCommitTrigger } from "./use-gui-field-draft";

// Small controls shared by the diagram GUI editors. Buttons use aria-disabled instead of
// the disabled attribute: a disabled button that holds focus drops it, and focus leaving
// the editor would end the edit (text-block-editor.tsx).

export interface GuiButtonProps {
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
  // Id of the visible text that says why the button is unavailable.
  readonly reasonId?: string;
  readonly variant?: "default" | "danger";
}

export function GuiButton({
  label,
  disabled,
  onPress,
  reasonId,
  variant = "default",
}: GuiButtonProps) {
  return (
    <button
      type="button"
      className={variant === "danger" ? "button button--danger" : "button"}
      aria-disabled={disabled}
      aria-describedby={disabled ? reasonId : undefined}
      onClick={() => {
        if (!disabled) onPress();
      }}
    >
      {label}
    </button>
  );
}

export interface GuiTextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  // Enter ("explicit") and leaving the field ("implicit") both ask to apply the value (the
  // same rule as the Source editor, where leaving commits); the caller ignores an unchanged
  // value and decides whether an earlier refusal is tried again (`useGuiFieldDraft`).
  // Resolves to true when the value was applied or needed no change, false when it was
  // refused.
  readonly onCommit: (trigger: GuiCommitTrigger) => Promise<boolean>;
  // Enter alone, when it differs from leaving the field (a form of several fields).
  readonly onEnter?: () => void;
  // Shown to assistive technology; typing stays possible while an operation runs.
  readonly busy: boolean;
  readonly invalid?: boolean;
  readonly describedBy?: string;
  readonly inputRef?: Ref<HTMLInputElement>;
}

export function GuiTextField({
  label,
  value,
  onChange,
  onCommit,
  onEnter,
  busy,
  invalid = false,
  describedBy,
  inputRef,
}: GuiTextFieldProps) {
  const inputId = useId();
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter that confirms an IME composition is not a request to apply.
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (onEnter !== undefined) onEnter();
    else void onCommit("explicit");
  }
  return (
    <div className="diagram-gui__field">
      <label className="diagram-gui__field-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        ref={inputRef}
        className="diagram-gui__input"
        type="text"
        spellCheck={false}
        autoComplete="off"
        value={value}
        aria-busy={busy}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => void onCommit("implicit")}
      />
    </div>
  );
}
