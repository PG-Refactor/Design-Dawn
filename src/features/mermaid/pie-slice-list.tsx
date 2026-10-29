import { type KeyboardEvent, type Ref, useId } from "react";
import type { PieSliceView } from "../../domain/diagram/pie/pie-view";
import { useMessages } from "../workspace/use-messages";

export interface PieSliceListProps {
  readonly shortId: string;
  readonly slices: readonly PieSliceView[];
  readonly selectedIndex: number | null;
  readonly onSelect: (index: number) => void;
  // Enter on the list moves to the editor of the selected slice.
  readonly onEnter: () => void;
  readonly listRef: Ref<HTMLDivElement>;
}

// The slices as one keyboard-navigable listbox. The list itself keeps the focus and names
// the selected row with aria-activedescendant, so focus never sits on a row that an
// operation can remove.
export function PieSliceList({
  shortId,
  slices,
  selectedIndex,
  onSelect,
  onEnter,
  listRef,
}: PieSliceListProps) {
  const gui = useMessages().mermaid.gui;
  const idPrefix = useId();
  const optionId = (index: number) => `${idPrefix}-slice-${index}`;
  const lastIndex = slices.length - 1;

  function moveTo(index: number) {
    onSelect(Math.min(Math.max(index, 0), lastIndex));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = selectedIndex ?? -1;
    switch (event.key) {
      case "ArrowDown":
        moveTo(current + 1);
        break;
      case "ArrowUp":
        moveTo(current < 0 ? lastIndex : current - 1);
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(lastIndex);
        break;
      case "Enter":
        if (selectedIndex !== null) onEnter();
        break;
      default:
        return;
    }
    // The arrow keys must not scroll the panel.
    event.preventDefault();
  }

  if (slices.length === 0) {
    return <p className="diagram-gui__empty">{gui.emptySlices}</p>;
  }
  return (
    <div
      ref={listRef}
      role="listbox"
      tabIndex={0}
      aria-label={gui.listLabel(shortId)}
      aria-activedescendant={
        selectedIndex === null ? undefined : optionId(selectedIndex)
      }
      className="diagram-gui__list"
      onKeyDown={onKeyDown}
    >
      {slices.map((slice) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard is handled on the listbox (arrow keys), which owns the focus.
        // biome-ignore lint/a11y/useFocusableInteractive: rows are reached through aria-activedescendant of the listbox.
        <div
          key={slice.index}
          id={optionId(slice.index)}
          role="option"
          aria-selected={slice.index === selectedIndex}
          aria-label={gui.sliceOption(slice.displayLabel, slice.valueText)}
          className="diagram-gui__option"
          onClick={() => onSelect(slice.index)}
        >
          <span
            className="diagram-gui__option-label"
            title={slice.displayLabel}
          >
            {slice.displayLabel}
          </span>
          <span className="diagram-gui__option-value">{slice.valueText}</span>
        </div>
      ))}
    </div>
  );
}
