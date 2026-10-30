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
  readonly inputRef?: Ref<HTMLInputElement | HTMLTextAreaElement>;
  // A label that may hold line breaks (Shift+Enter inserts one; Enter still applies).
  readonly multiline?: boolean;
  // Shown instead of an editable field's behaviour when the value cannot be changed from
  // the GUI: the field stays focusable and readable, but typing is ignored.
  readonly readOnly?: boolean;
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
  multiline = false,
  readOnly = false,
}: GuiTextFieldProps) {
  const inputId = useId();
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    // Enter that confirms an IME composition is not a request to apply.
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    // Shift+Enter in a multiline field is a line break, not a request to apply.
    if (multiline && event.shiftKey) return;
    event.preventDefault();
    if (onEnter !== undefined) onEnter();
    else void onCommit("explicit");
  }
  const common = {
    id: inputId,
    className: "diagram-gui__input",
    spellCheck: false,
    autoComplete: "off",
    value,
    readOnly,
    "aria-busy": busy,
    "aria-invalid": invalid,
    "aria-describedby": describedBy,
    onKeyDown,
    onBlur: () => void onCommit("implicit"),
  } as const;
  return (
    <div className="diagram-gui__field">
      <label className="diagram-gui__field-label" htmlFor={inputId}>
        {label}
      </label>
      {multiline ? (
        <textarea
          {...common}
          ref={inputRef as Ref<HTMLTextAreaElement>}
          rows={1}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          {...common}
          ref={inputRef as Ref<HTMLInputElement>}
          type="text"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}

export interface GuiSelectOption {
  readonly value: string;
  readonly label: string;
}

export interface GuiSelectProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly GuiSelectOption[];
  readonly onChange: (value: string) => void;
  // Not `disabled`: a disabled control that holds focus drops it (see above). A change is
  // ignored while unavailable and the control keeps showing its value.
  readonly disabled: boolean;
  // Id of the visible text that says why the control is unavailable.
  readonly reasonId?: string;
}

export function GuiSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  reasonId,
}: GuiSelectProps) {
  const selectId = useId();
  return (
    <div className="diagram-gui__field">
      <label className="diagram-gui__field-label" htmlFor={selectId}>
        {label}
      </label>
      <select
        id={selectId}
        className="diagram-gui__input"
        value={value}
        aria-disabled={disabled}
        aria-describedby={disabled ? reasonId : undefined}
        onChange={(event) => {
          if (!disabled) onChange(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export interface GuiCheckboxProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  // Not `disabled`, for the same reason as the other controls: a change is ignored while
  // unavailable and the box keeps showing its state.
  readonly disabled: boolean;
  readonly reasonId?: string;
}

export function GuiCheckbox({
  label,
  checked,
  onChange,
  disabled,
  reasonId,
}: GuiCheckboxProps) {
  return (
    <label className="diagram-gui__check">
      <input
        type="checkbox"
        checked={checked}
        aria-disabled={disabled}
        aria-describedby={disabled ? reasonId : undefined}
        onChange={(event) => {
          if (!disabled) onChange(event.target.checked);
        }}
      />
      {label}
    </label>
  );
}
