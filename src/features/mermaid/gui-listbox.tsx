import { type KeyboardEvent, type ReactNode, type Ref, useId } from "react";

export interface GuiListboxItem {
  readonly key: string;
  // The accessible name of the row (the visible text may be shortened).
  readonly name: string;
  readonly content: ReactNode;
}

export interface GuiListboxProps {
  readonly label: string;
  readonly items: readonly GuiListboxItem[];
  readonly selectedKey: string | null;
  readonly onSelect: (key: string) => void;
  // Enter on the list moves to the editor of the selected row.
  readonly onEnter: () => void;
  readonly listRef: Ref<HTMLDivElement>;
}

// A keyboard-navigable listbox. The list itself keeps the focus and names the selected row
// with aria-activedescendant, so focus never sits on a row that an operation can remove.
export function GuiListbox({
  label,
  items,
  selectedKey,
  onSelect,
  onEnter,
  listRef,
}: GuiListboxProps) {
  const idPrefix = useId();
  const optionId = (position: number) => `${idPrefix}-option-${position}`;
  const selectedPosition = items.findIndex((item) => item.key === selectedKey);
  const lastPosition = items.length - 1;

  function moveTo(position: number) {
    const target = items[Math.min(Math.max(position, 0), lastPosition)];
    if (target !== undefined) onSelect(target.key);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "ArrowDown":
        moveTo(selectedPosition + 1);
        break;
      case "ArrowUp":
        moveTo(selectedPosition < 0 ? lastPosition : selectedPosition - 1);
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(lastPosition);
        break;
      case "Enter":
        if (selectedPosition >= 0) onEnter();
        break;
      default:
        return;
    }
    // The arrow keys must not scroll the panel.
    event.preventDefault();
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      tabIndex={0}
      aria-label={label}
      aria-activedescendant={
        selectedPosition < 0 ? undefined : optionId(selectedPosition)
      }
      className="diagram-gui__list"
      onKeyDown={onKeyDown}
    >
      {items.map((item, position) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard is handled on the listbox (arrow keys), which owns the focus.
        // biome-ignore lint/a11y/useFocusableInteractive: rows are reached through aria-activedescendant of the listbox.
        <div
          key={item.key}
          id={optionId(position)}
          role="option"
          aria-selected={item.key === selectedKey}
          aria-label={item.name}
          className="diagram-gui__option"
          onClick={() => onSelect(item.key)}
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
