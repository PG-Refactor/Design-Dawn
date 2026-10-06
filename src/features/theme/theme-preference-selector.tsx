import { useId } from "react";
import "./theme-preference-selector.css";

// Presentational only: it knows nothing about themes, stores or gateways, so it can move
// into a settings screen unchanged. Native radios give keyboard operation (arrow keys).
export interface SelectorOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
}

export interface ThemePreferenceSelectorProps<Value extends string> {
  readonly legend: string;
  readonly value: Value;
  readonly options: readonly SelectorOption<Value>[];
  readonly onChange: (value: Value) => void;
  readonly disabled?: boolean;
}

export function ThemePreferenceSelector<Value extends string>({
  legend,
  value,
  options,
  onChange,
  disabled = false,
}: ThemePreferenceSelectorProps<Value>) {
  const groupName = useId();
  return (
    <fieldset className="theme-preference-selector" disabled={disabled}>
      <legend className="theme-preference-selector__legend">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="theme-preference-selector__option">
          <input
            type="radio"
            name={groupName}
            value={option.value}
            checked={option.value === value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
