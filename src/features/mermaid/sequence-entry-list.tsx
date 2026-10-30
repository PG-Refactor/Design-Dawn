import type { Ref } from "react";
import type { SequenceEntryView } from "../../domain/diagram/sequence/sequence-view";
import { useMessages } from "../workspace/use-messages";
import { GuiListbox } from "./gui-listbox";
import { describeEntry, entryKey } from "./sequence-entry-text";

export interface SequenceEntryListProps {
  readonly shortId: string;
  readonly entries: readonly SequenceEntryView[];
  readonly selectedKey: string | null;
  readonly onSelect: (key: string) => void;
  readonly onEnter: () => void;
  readonly listRef: Ref<HTMLDivElement>;
}

// The messages, notes and blocks in the order of the text. The nesting of blocks is shown by
// indenting the rows; the row's own text says which block it belongs to.
export function SequenceEntryList({
  shortId,
  entries,
  selectedKey,
  onSelect,
  onEnter,
  listRef,
}: SequenceEntryListProps) {
  const text = useMessages().mermaid.gui.sequence;
  if (entries.length === 0) {
    return <p className="diagram-gui__empty">{text.emptyEntries}</p>;
  }
  return (
    <GuiListbox
      label={text.entryListLabel(shortId)}
      selectedKey={selectedKey}
      onSelect={onSelect}
      onEnter={onEnter}
      listRef={listRef}
      items={entries.map((entry) => {
        const name = describeEntry(text, entry);
        return {
          key: entryKey(entry),
          name,
          content: (
            <span
              className="diagram-gui__option-label"
              title={name}
              style={{
                paddingInlineStart: `calc(var(--space-3) * ${entry.depth})`,
              }}
            >
              {name}
            </span>
          ),
        };
      })}
    />
  );
}
