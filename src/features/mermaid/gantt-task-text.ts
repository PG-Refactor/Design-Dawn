import type {
  GanttSectionView,
  GanttTaskView,
} from "../../domain/diagram/gantt/gantt-view";
import type { MermaidMessages } from "./mermaid-messages";

type GanttMessages = MermaidMessages["gui"]["gantt"];

// Single-line text for a list row.
function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ");
}

// The key of a section in the list: its position and name.
export function sectionKey(section: GanttSectionView): string {
  return `${section.target.index}:${section.target.name}`;
}

// The key of a task in the list: its position and name.
export function taskKey(task: GanttTaskView): string {
  return `${task.target.index}:${task.target.name}`;
}

export function describeSection(
  text: GanttMessages,
  section: GanttSectionView,
): string {
  return text.sectionOption(oneLine(section.target.name), section.taskCount);
}

// The row text of a task, also its accessible name.
export function describeTask(text: GanttMessages, task: GanttTaskView): string {
  return text.taskOption(
    task.sectionIndex < 0 ? text.noSectionName : oneLine(task.sectionName),
    oneLine(task.name),
    task.startText === "" ? text.implicitStartShown : task.startText,
    task.endText,
  );
}
