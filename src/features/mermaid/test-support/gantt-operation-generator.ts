// TEST ONLY. A seeded generator of random gantt operations for the operation-sequence test
// (gantt-operations.real.dom.test.ts). It reads the current chart and builds an operation
// from real names, ids and sections, with a fixed share of noise (stale targets, unknown or
// duplicate ids, invalid dates and durations, awkward names): whether the editor plans or
// refuses an operation is decided by the editor, and whether a plan is right is decided by
// Mermaid, not by this generator.
import { ganttEditability } from "../../../domain/diagram/gantt/gantt-editability";
import { ganttMeaningOf } from "../../../domain/diagram/gantt/gantt-meaning";
import type {
  GanttEndInput,
  GanttOperation,
  GanttStartInput,
} from "../../../domain/diagram/gantt/gantt-operations";
import { parseGantt } from "../../../domain/diagram/gantt/gantt-parser";
import type { RandomSource } from "./flowchart-generator";

const NOISE_RATE = 0.08;
const TITLES = ["Plan", "Release plan", "設計", "Roadmap 2024"] as const;
const NAMES = [
  "Alpha",
  "Beta test",
  "日本語",
  "Gamma",
  "Delta rollout",
  "Review",
] as const;
const ODD_NAMES = [
  "a: b",
  "title x",
  "5% rule",
  "x # y",
  "",
  "section z",
  "2024-01-01 go",
] as const;
const IDS = ["n1", "n2", "alpha", "x-9", "t_5", "k7"] as const;
const ODD_IDS = ["task4", "done", "a.b", "m 1", ""] as const;
const DATES = ["2024-01-03", "2024-02-29", "2024-03-15", "2023-12-31"] as const;
const ODD_DATES = ["2024-02-30", "2024-1-5", "soon"] as const;
const DURATIONS = ["1d", "3d", "2w", "5h", "90m", "0d"] as const;
const ODD_DURATIONS = ["5 days", "1w2d", "-1d", ""] as const;
const TAGS = ["active", "done", "crit", "milestone", "vert"] as const;

const OPERATION_KINDS = [
  "setTitle",
  "clearTitle",
  "addSection",
  "renameSection",
  "deleteSection",
  "addTask",
  "addTask",
  "renameTask",
  "setTaskId",
  "setStart",
  "setDuration",
  "setEnd",
  "setStatusTags",
  "deleteTask",
  "deleteTask",
] as const;

export function randomGanttOperation(
  source: string,
  random: RandomSource,
): GanttOperation | null {
  const parsed = parseGantt(source);
  if (!ganttEditability(parsed).editable) return null;
  const meaning = ganttMeaningOf(parsed);
  if (meaning === null) return null;
  const pick = <T>(values: readonly T[]): T =>
    values[Math.floor(random() * values.length)] as T;
  const noisy = () => random() < NOISE_RATE;
  const ids = meaning.tasks.flatMap((task) =>
    task.id === null ? [] : [task.id],
  );
  const target = () => {
    const index = Math.floor(random() * meaning.tasks.length);
    const name = (meaning.tasks[index]?.name ?? "") + (noisy() ? " stale" : "");
    return { index, name };
  };
  const sectionTarget = () => {
    const index = Math.floor(random() * meaning.sections.length);
    return {
      index,
      name: (meaning.sections[index] ?? "") + (noisy() ? " stale" : ""),
    };
  };
  const date = () => (noisy() ? pick(ODD_DATES) : pick(DATES));
  const duration = () => (noisy() ? pick(ODD_DURATIONS) : pick(DURATIONS));
  const someIds = (): readonly string[] => {
    if (ids.length === 0 || noisy()) return [pick(IDS)];
    const first = pick(ids);
    return random() < 0.2 ? [...new Set([first, pick(ids)])] : [first];
  };
  const start = (): GanttStartInput =>
    random() < 0.5
      ? { kind: "date", text: date() }
      : { kind: "after", ids: someIds() };
  const end = (): GanttEndInput => {
    const roll = random();
    if (roll < 0.6) return { kind: "duration", text: duration() };
    if (roll < 0.85) return { kind: "date", text: date() };
    return { kind: "until", ids: someIds() };
  };
  const name = () => (noisy() ? pick(ODD_NAMES) : pick(NAMES));
  const tags = () => {
    const chosen: (typeof TAGS)[number][] = [];
    while (random() < 0.4) chosen.push(pick(TAGS));
    return noisy() ? chosen : [...new Set(chosen)];
  };
  const taskCount = meaning.tasks.length;
  const sectionCount = meaning.sections.length;
  const kind = pick(OPERATION_KINDS);
  switch (kind) {
    case "setTitle":
      return { kind, title: noisy() ? "a;b" : pick(TITLES) };
    case "clearTitle":
      return { kind };
    case "addSection":
      return {
        kind,
        name: noisy() ? pick(ODD_NAMES) : `Part ${Math.floor(random() * 5)}`,
        ...(sectionCount > 0 && random() < 0.6
          ? { afterSectionIndex: Math.floor(random() * sectionCount) }
          : {}),
      };
    case "renameSection":
      return sectionCount === 0
        ? null
        : {
            kind,
            target: sectionTarget(),
            name: noisy()
              ? pick(meaning.sections)
              : `Stage ${Math.floor(random() * 5)}`,
          };
    case "deleteSection":
      return sectionCount === 0 ? null : { kind, target: sectionTarget() };
    case "addTask":
      return {
        kind,
        ...(sectionCount > 0 && random() < 0.6
          ? { sectionIndex: Math.floor(random() * sectionCount) }
          : {}),
        name: name(),
        ...(random() < 0.6 ? { id: noisy() ? pick(ODD_IDS) : pick(IDS) } : {}),
        ...(random() < 0.4 ? { tags: tags() } : {}),
        start: start(),
        end: end(),
      };
    case "renameTask":
      return taskCount === 0 ? null : { kind, target: target(), name: name() };
    case "setTaskId":
      return taskCount === 0
        ? null
        : {
            kind,
            target: target(),
            id: noisy()
              ? pick(ODD_IDS)
              : random() < 0.3 && ids.length > 0
                ? pick(ids)
                : pick(IDS),
          };
    case "setStart":
      return taskCount === 0
        ? null
        : { kind, target: target(), start: start() };
    case "setDuration":
      return taskCount === 0
        ? null
        : { kind, target: target(), duration: duration() };
    case "setEnd":
      return taskCount === 0 ? null : { kind, target: target(), end: end() };
    case "setStatusTags":
      return taskCount === 0 ? null : { kind, target: target(), tags: tags() };
    case "deleteTask":
      return taskCount === 0 ? null : { kind, target: target() };
  }
}
