import type { GanttTag } from "./gantt-config";
import {
  GANTT_EXCLUDE_TOKEN_SEPARATOR,
  GANTT_GENERATED_ID_PREFIX,
  type GanttDateFormat,
} from "./gantt-config";
import { ganttEditability } from "./gantt-editability";
import { excludeTokensOf } from "./gantt-excludes";
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

// What a control would do, found by planning the operation: why it is unavailable (the first
// word of the refusal) or null, and how many implicit starts it would write as explicit dates
// to keep every date where it is (docs/architecture.md §16.17.2).
export interface GanttMoveView {
  readonly restriction: string | null;
  readonly freezes: number;
}

export interface GanttSectionView {
  readonly target: GanttSectionTarget;
  readonly taskCount: number;
  readonly deleteRestriction: string | null;
  readonly moveUp: GanttMoveView;
  readonly moveDown: GanttMoveView;
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
  readonly moveUp: GanttMoveView;
  readonly moveDown: GanttMoveView;
  readonly duplicateRestriction: string | null;
  // The target of the task's `click ... href` line, or "" without one.
  readonly link: string;
  // Why a link cannot be added (a task with an id and no link can have one) / removed.
  readonly addLinkRestriction: string | null;
  readonly removeLinkRestriction: string | null;
}

export interface GanttView {
  readonly title: string;
  readonly titleRestriction: string | null;
  readonly dateFormat: GanttDateFormat;
  // The `axisFormat` in force, or "" when the chart has none.
  readonly axisFormat: string;
  readonly axisFormatRestriction: string | null;
  // The excluded days and dates as written, joined by ", ", or "" when there are none.
  readonly excludes: string;
  readonly excludesRestriction: string | null;
  readonly sections: readonly GanttSectionView[];
  readonly tasks: readonly GanttTaskView[];
}

const PROBE_TEXT = "x";
const PROBE_AXIS_FORMAT = "%m/%d";
const PROBE_EXCLUDE_TOKEN = "weekends";
const PROBE_LINK = "https://example.com/";
const PROBE_ID_SUFFIX = "probe";

// The first word of the reason a plan is refused with, or null when it is planned.
function refusalOf(source: string, operation: GanttOperation): string | null {
  const plan = planGanttOperation(source, operation);
  if (plan.ok) return null;
  return plan.error.detail.split(":")[0]?.trim() ?? null;
}

function moveViewOf(source: string, operation: GanttOperation): GanttMoveView {
  const plan = planGanttOperation(source, operation);
  if (!plan.ok) {
    return {
      restriction: plan.error.detail.split(":")[0]?.trim() ?? null,
      freezes: 0,
    };
  }
  return { restriction: null, freezes: plan.value.frozenTasks?.length ?? 0 };
}

export interface GanttMoveTargetView {
  readonly sectionIndex: number;
  readonly name: string;
  readonly restriction: string | null;
  readonly freezes: number;
}

// For the "move to section" control of one task: each other section, with whether the move
// can be done. Computed on demand for the selected task only (one plan per section).
export function readGanttMoveTargets(
  source: string,
  task: GanttTaskTarget,
): readonly GanttMoveTargetView[] {
  const view = readGanttView(source);
  if (view === null) return [];
  return view.sections.map((section) => ({
    sectionIndex: section.target.index,
    name: section.target.name,
    ...moveViewOf(source, {
      kind: "moveTaskToSection",
      target: task,
      sectionIndex: section.target.index,
    }),
  }));
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

  const linkOf = (id: string | null): string =>
    id === null
      ? ""
      : (meaning.links.find((link) => link.id === id)?.url ?? "");
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
      moveUp: moveViewOf(source, { kind: "moveTask", target, direction: "up" }),
      moveDown: moveViewOf(source, {
        kind: "moveTask",
        target,
        direction: "down",
      }),
      duplicateRestriction: refusalOf(source, {
        kind: "duplicateTask",
        target,
      }),
      link: linkOf(task.id),
      addLinkRestriction:
        linkOf(task.id) !== ""
          ? "alreadyLinked"
          : refusalOf(source, { kind: "addLink", target, url: PROBE_LINK }),
      removeLinkRestriction: refusalOf(source, { kind: "removeLink", target }),
    };
  });
  const sections = meaning.sections.map((name, index): GanttSectionView => {
    const target = { index, name };
    return {
      target,
      taskCount: tasks.filter((task) => task.sectionIndex === index).length,
      deleteRestriction: refusalOf(source, { kind: "deleteSection", target }),
      moveUp: moveViewOf(source, {
        kind: "moveSection",
        target,
        direction: "up",
      }),
      moveDown: moveViewOf(source, {
        kind: "moveSection",
        target,
        direction: "down",
      }),
    };
  });
  return {
    title: meaning.title,
    titleRestriction: refusalOf(source, {
      kind: "setTitle",
      title: PROBE_TEXT,
    }),
    dateFormat: meaning.dateFormat,
    axisFormat:
      meaning.settings
        .filter((setting) => setting.keyword === "axisformat")
        .at(-1)?.value ?? "",
    axisFormatRestriction: refusalOf(source, {
      kind: "setAxisFormat",
      format: PROBE_AXIS_FORMAT,
    }),
    excludes: excludeTokensOf(meaning.settings).join(
      GANTT_EXCLUDE_TOKEN_SEPARATOR,
    ),
    excludesRestriction: refusalOf(source, {
      kind: "setExcludes",
      tokens: [PROBE_EXCLUDE_TOKEN],
    }),
    sections,
    tasks,
  };
}
