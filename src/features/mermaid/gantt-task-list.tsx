import type { Ref } from "react";
import type { GanttTaskView } from "../../domain/diagram/gantt/gantt-view";
import { useMessages } from "../workspace/use-messages";
import { describeTask, taskKey } from "./gantt-task-text";
import { GuiListbox } from "./gui-listbox";

export interface GanttTaskListProps {
  readonly shortId: string;
  readonly tasks: readonly GanttTaskView[];
  readonly selectedKey: string | null;
  readonly onSelect: (key: string) => void;
  readonly onEnter: () => void;
  readonly listRef: Ref<HTMLDivElement>;
}

// The tasks in the order of the text, each row naming its section.
export function GanttTaskList({
  shortId,
  tasks,
  selectedKey,
  onSelect,
  onEnter,
  listRef,
}: GanttTaskListProps) {
  const text = useMessages().mermaid.gui.gantt;
  if (tasks.length === 0) {
    return <p className="diagram-gui__empty">{text.emptyTasks}</p>;
  }
  return (
    <GuiListbox
      label={text.taskListLabel(shortId)}
      selectedKey={selectedKey}
      onSelect={onSelect}
      onEnter={onEnter}
      listRef={listRef}
      items={tasks.map((task) => {
        const name = describeTask(text, task);
        return {
          key: taskKey(task),
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
