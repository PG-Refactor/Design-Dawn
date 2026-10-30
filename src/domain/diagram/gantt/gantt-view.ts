import type { GanttTag } from "./gantt-config";
import {
  GANTT_GENERATED_ID_PREFIX,
  type GanttDateFormat,
} from "./gantt-config";
import { ganttEditability } from "./gantt-editability";
import { ganttEndText, ganttStartText } from "./gantt-input";
import { ganttMeaningOf } from "./gantt-meaning";
import {
  type GanttOperation,
  type GanttSectionTarget,
  type GanttTaskTarget,
  planGanttOperation,
} from "./gantt-operations";
import { parseGantt } from "./gantt-parser";

// What the gantt GUI shows of an editable gantt chart. Read-only and derived from the source
// on every call, so the GUI never holds a model of its own that could drift from the text
// (the same rule as SequenceView and FlowchartView).
//
// `restriction` fields say why a control is unavailable: the first word of the refusal the
// operation would give, found by planning the operation (nothing is applied).

export interface GanttSectionView {
  readonly target: GanttSectionTarget;
  readonly taskCount: number;
  readonly deleteRestriction: string | null;
}

export interface GanttTaskView {
  readonly target: GanttTaskTarget;
  // Index into `sections`, or -1 for a task above the first `section`.
  readonly sectionIndex: number;
  readonly sectionName: string;
  readonly name: string;
  readonly id: string | null;
  readonly tags: readonly GanttTag[];
  // As written: a date, `after a b`, or "" for a start taken from the task above.
  readonly startText: string;
  // As written: a duration, a date or `until a`.
  readonly endText: string;
  readonly idRestriction: string | null;
  readonly deleteRestriction: string | null;
}

export interface GanttView {
  readonly title: string;
  readonly titleRestriction: string | null;
  readonly dateFormat: GanttDateFormat;
  readonly sections: readonly GanttSectionView[];
  readonly tasks: readonly GanttTaskView[];
}

const PROBE_TEXT = "x";
const PROBE_ID_SUFFIX = "probe";

// The first word of the reason a plan is refused with, or null when it is planned.
function refusalOf(source: string, operation: GanttOperation): string | null {
  const plan = planGanttOperation(source, operation);
  if (plan.ok) return null;
  return plan.error.detail.split(":")[0]?.trim() ?? null;
}

// Null when the source is not an editable gantt chart (the GUI shows the reason).
export function readGanttView(source: string): GanttView | null {
  const parsed = parseGantt(source);
  if (!ganttEditability(parsed).editable) return null;
  const meaning = ganttMeaningOf(parsed);
  if (meaning === null) return null;

  const knownIds = new Set(
    meaning.tasks.flatMap((task) => (task.id === null ? [] : [task.id])),
  );
  let probeId = `${GANTT_GENERATED_ID_PREFIX}${PROBE_ID_SUFFIX}`;
  while (knownIds.has(probeId)) probeId += PROBE_ID_SUFFIX;

  const tasks = meaning.tasks.map((task, index): GanttTaskView => {
    const target = { index, name: task.name };
    const entry = parsed.tasks[index];
    return {
      target,
      sectionIndex: entry?.sectionIndex ?? -1,
      sectionName: task.section,
      name: task.name,
      id: task.id,
      tags: task.tags,
      startText: ganttStartText(task.start),
      endText: ganttEndText(task.end),
      // Only a task without an id can be refused here (it needs a start of its own first).
      idRestriction:
        task.id === null
          ? refusalOf(source, { kind: "setTaskId", target, id: probeId })
          : null,
      deleteRestriction: refusalOf(source, { kind: "deleteTask", target }),
    };
  });
  const sections = meaning.sections.map((name, index): GanttSectionView => {
    const target = { index, name };
    return {
      target,
      taskCount: tasks.filter((task) => task.sectionIndex === index).length,
      deleteRestriction: refusalOf(source, { kind: "deleteSection", target }),
    };
  });
  return {
    title: meaning.title,
    titleRestriction: refusalOf(source, {
      kind: "setTitle",
      title: PROBE_TEXT,
    }),
    dateFormat: meaning.dateFormat,
    sections,
    tasks,
  };
}
