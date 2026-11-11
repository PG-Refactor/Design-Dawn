import { type KeyboardEvent, type ReactNode, type Ref, useId } from "react";
import type { FindFields } from "./find-store";
import "./find-fields.css";

export interface FindFieldsLabels {
  readonly queryLabel: string;
  readonly matchCase: string;
  readonly toggleReplace: string;
  readonly replacementLabel: string;
  readonly replaceAll: string;
}

// The find box both searches share, laid out as in VS Code: an arrow that shows the
// replace row, the text with an "Aa" (match case) toggle, and the replacement with its
// buttons. Enter (Shift+Enter) in the text and the replacement is handed to the owner.
export function FindFieldsView({
  fields,
  labels,
  onChange,
  onQueryEnter,
  onReplacementEnter,
  onReplaceAll,
  replaceDisabled,
  queryRef,
  queryTrailing,
  replaceButtons,
  onKeyDown,
}: {
  readonly fields: FindFields;
  readonly labels: FindFieldsLabels;
  readonly onChange: (change: Partial<FindFields>) => void;
  readonly onQueryEnter: (backwards: boolean) => void;
  readonly onReplacementEnter?: () => void;
  readonly onReplaceAll: () => void;
  readonly replaceDisabled: boolean;
  readonly queryRef?: Ref<HTMLInputElement>;
  // After the text field: the match count, previous / next (the sheet's box).
  readonly queryTrailing?: ReactNode;
  // Before "Replace All": "Replace" (the sheet's box).
  readonly replaceButtons?: ReactNode;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const replaceRowId = useId();
  function enterOf(handler: (shiftKey: boolean) => void) {
    return (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
      event.preventDefault();
      handler(event.shiftKey);
    };
  }
  return (
    // Escape and the find shortcuts inside the box are handled by its owner.
    // biome-ignore lint/a11y/noStaticElementInteractions: a key handler for the whole box, whose controls are its own.
    <div className="find-fields" onKeyDown={onKeyDown}>
      <button
        type="button"
        className="find-fields__toggle"
        aria-label={labels.toggleReplace}
        title={labels.toggleReplace}
        aria-expanded={fields.replaceShown}
        aria-controls={replaceRowId}
        onClick={() => onChange({ replaceShown: !fields.replaceShown })}
      >
        <span aria-hidden="true">{fields.replaceShown ? "▾" : "▸"}</span>
      </button>
      <div className="find-fields__rows">
        <div className="find-fields__row">
          <div className="find-fields__box">
            <input
              ref={queryRef}
              type="search"
              className="find-fields__input"
              aria-label={labels.queryLabel}
              placeholder={labels.queryLabel}
              value={fields.query}
              onChange={(event) => onChange({ query: event.target.value })}
              onKeyDown={enterOf(onQueryEnter)}
            />
            <button
              type="button"
              className="find-fields__option"
              aria-label={labels.matchCase}
              title={labels.matchCase}
              aria-pressed={fields.matchCase}
              onClick={() => onChange({ matchCase: !fields.matchCase })}
            >
              <span aria-hidden="true">Aa</span>
            </button>
          </div>
          {queryTrailing}
        </div>
        <div
          className="find-fields__row"
          id={replaceRowId}
          hidden={!fields.replaceShown}
        >
          <div className="find-fields__box">
            <input
              type="text"
              className="find-fields__input"
              aria-label={labels.replacementLabel}
              placeholder={labels.replacementLabel}
              value={fields.replacement}
              onChange={(event) =>
                onChange({ replacement: event.target.value })
              }
              onKeyDown={enterOf(() => onReplacementEnter?.())}
            />
          </div>
          {replaceButtons}
          <button
            type="button"
            className="find-fields__action"
            disabled={replaceDisabled}
            onClick={onReplaceAll}
          >
            {labels.replaceAll}
          </button>
        </div>
      </div>
    </div>
  );
}
