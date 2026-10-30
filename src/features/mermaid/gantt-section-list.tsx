import type { Ref } from "react";
import type { GanttSectionView } from "../../domain/diagram/gantt/gantt-view";
import { useMessages } from "../workspace/use-messages";
import { describeSection, sectionKey } from "./gantt-task-text";
import { GuiListbox } from "./gui-listbox";

export interface GanttSectionListProps {
  readonly shortId: string;
  readonly sections: readonly GanttSectionView[];
  readonly selectedKey: string | null;
  readonly onSelect: (key: string) => void;
  readonly onEnter: () => void;
  readonly listRef: Ref<HTMLDivElement>;
}

export function GanttSectionList({
  shortId,
  sections,
  selectedKey,
  onSelect,
  onEnter,
  listRef,
}: GanttSectionListProps) {
  const text = useMessages().mermaid.gui.gantt;
  if (sections.length === 0) {
    return <p className="diagram-gui__empty">{text.emptySections}</p>;
  }
  return (
    <GuiListbox
      label={text.sectionListLabel(shortId)}
      selectedKey={selectedKey}
      onSelect={onSelect}
      onEnter={onEnter}
      listRef={listRef}
      items={sections.map((section) => {
        const name = describeSection(text, section);
        return {
          key: sectionKey(section),
          name,
          content: (
            <span className="diagram-gui__option-label" title={name}>
              {name}
            </span>
          ),
        };
      })}
    />
  );
}
