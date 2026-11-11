// Building blocks of the ER, state and class diagram editors: a list to choose an item
// from, and a small form of fields that becomes one operation. The panels derive every list
// from the committed text on each render, so nothing here holds a copy of the diagram.

import { type FormEvent, useId, useState } from "react";

export interface ListedItem {
  readonly key: string;
  readonly label: string;
  // A second, quieter line (an entity's attribute count, a transition's label ...).
  readonly detail?: string;
}

export function ListedList({
  label,
  items,
  selectedKey,
  emptyText,
  onSelect,
}: {
  readonly label: string;
  readonly items: readonly ListedItem[];
  readonly selectedKey: string | null;
  readonly emptyText: string;
  readonly onSelect: (key: string) => void;
}) {
  if (items.length === 0) {
    return <p className="diagram-gui__hint">{emptyText}</p>;
  }
  return (
    <ul className="listed-gui__list" aria-label={label}>
      {items.map((item) => (
        <li key={item.key}>
          <button
            type="button"
            className="listed-gui__item"
            aria-pressed={item.key === selectedKey}
            onClick={() => onSelect(item.key)}
          >
            <span>{item.label}</span>
            {item.detail !== undefined && item.detail !== "" && (
              <span className="listed-gui__detail">{item.detail}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

export type FieldValue = string | boolean;

export type ListedField =
  | { readonly id: string; readonly label: string; readonly kind: "text" }
  | {
      readonly id: string;
      readonly label: string;
      readonly kind: "select";
      readonly options: readonly {
        readonly value: string;
        readonly label: string;
      }[];
    }
  | { readonly id: string; readonly label: string; readonly kind: "checkbox" };

export type FieldValues = Readonly<Record<string, FieldValue>>;

export function textValue(values: FieldValues, id: string): string {
  const value = values[id];
  return typeof value === "string" ? value : "";
}

export function checkedValue(values: FieldValues, id: string): boolean {
  return values[id] === true;
}

// One form: the fields, a submit button and, for an existing item, a delete button. It
// starts from `initial`; the parent gives it a new `key` to start over (another item).
export function ListedForm({
  title,
  fields,
  initial,
  submitLabel,
  busy,
  onSubmit,
  deleteLabel,
  onDelete,
}: {
  readonly title: string;
  readonly fields: readonly ListedField[];
  readonly initial: FieldValues;
  readonly submitLabel: string;
  readonly busy: boolean;
  // True when the operation was applied (an add form then empties itself).
  readonly onSubmit: (values: FieldValues) => Promise<boolean>;
  readonly deleteLabel?: string;
  readonly onDelete?: () => void;
}) {
  const [values, setValues] = useState<FieldValues>(initial);
  const formId = useId();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const applied = await onSubmit(values);
    if (applied && onDelete === undefined) setValues(initial);
  }

  return (
    <form
      className="listed-gui__form"
      aria-label={title}
      onSubmit={(event) => void submit(event)}
    >
      <h5 className="listed-gui__form-title">{title}</h5>
      {fields.map((field) => {
        const id = `${formId}-${field.id}`;
        if (field.kind === "checkbox") {
          return (
            <label key={field.id} className="listed-gui__check" htmlFor={id}>
              <input
                id={id}
                type="checkbox"
                checked={checkedValue(values, field.id)}
                onChange={(event) =>
                  setValues({ ...values, [field.id]: event.target.checked })
                }
              />
              {field.label}
            </label>
          );
        }
        return (
          <label key={field.id} className="listed-gui__field" htmlFor={id}>
            <span>{field.label}</span>
            {field.kind === "select" ? (
              <select
                id={id}
                value={textValue(values, field.id)}
                onChange={(event) =>
                  setValues({ ...values, [field.id]: event.target.value })
                }
              >
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                type="text"
                value={textValue(values, field.id)}
                onChange={(event) =>
                  setValues({ ...values, [field.id]: event.target.value })
                }
              />
            )}
          </label>
        );
      })}
      <div className="listed-gui__actions">
        <button type="submit" className="button" disabled={busy}>
          {submitLabel}
        </button>
        {onDelete !== undefined && deleteLabel !== undefined && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={onDelete}
          >
            {deleteLabel}
          </button>
        )}
      </div>
    </form>
  );
}
