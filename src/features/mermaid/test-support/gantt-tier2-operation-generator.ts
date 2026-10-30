// TEST ONLY. A seeded generator of Tier 2 gantt operations,
// mixed with the Tier 1 generator. It builds operations from the real tasks and sections of
// the current chart plus a fixed share of noise (stale targets, odd tokens, odd links).
import { ganttEditability } from "../../../domain/diagram/gantt/gantt-editability";
import { ganttMeaningOf } from "../../../domain/diagram/gantt/gantt-meaning";
import type { GanttOperation } from "../../../domain/diagram/gantt/gantt-operations";
import { parseGantt } from "../../../domain/diagram/gantt/gantt-parser";
import type { RandomSource } from "./flowchart-generator";
import { randomGanttOperation } from "./gantt-operation-generator";

const NOISE_RATE = 0.08;
const TIER1_SHARE = 0.3;
const AXIS_FORMATS = [
  "%m/%d",
  "%Y-%m-%d",
  "%b %d",
  "Week %W",
  "%-d %b",
] as const;
const ODD_AXIS_FORMATS = ["%E", "%m # x", "", "%%", "100%"] as const;
const EXCLUDE_SETS: readonly (readonly string[])[] = [
  ["weekends"],
  ["saturday"],
  ["sunday", "monday"],
  ["2024-01-03"],
  ["weekends", "2024-01-10"],
  ["friday"],
];
const ODD_EXCLUDE_SETS: readonly (readonly string[])[] = [
  ["holiday"],
  [],
  ["monday", "monday"],
  ["2024-02-30"],
  ["monday", "tuesday", "wednesday", "thursday", "friday", "weekends"],
];
const URLS = [
  "https://example.com/",
  "http://example.org/a/b?x=1&y=2",
  "https://example.com/path",
] as const;
const ODD_URLS = [
  "javascript:alert(1)",
  "ftp://x/",
  "https://a b/",
  "https://x/#y",
] as const;
const DIRECTIONS = ["up", "down"] as const;

const TIER2_KINDS = [
  "moveTask",
  "moveTask",
  "moveTaskToSection",
  "moveTaskToSection",
  "moveSection",
  "moveSection",
  "moveSection",
  "duplicateTask",
  "setAxisFormat",
  "setExcludes",
  "clearExcludes",
  "addLink",
  "removeLink",
] as const;

export function randomGanttTier2Operation(
  source: string,
  random: RandomSource,
): GanttOperation | null {
  if (random() < TIER1_SHARE) return randomGanttOperation(source, random);
  const parsed = parseGantt(source);
  if (!ganttEditability(parsed).editable) return null;
  const meaning = ganttMeaningOf(parsed);
  if (meaning === null) return null;
  const pick = <T>(values: readonly T[]): T =>
    values[Math.floor(random() * values.length)] as T;
  const noisy = () => random() < NOISE_RATE;
  const taskTarget = () => {
    const index = Math.floor(random() * meaning.tasks.length);
    return {
      index,
      name: (meaning.tasks[index]?.name ?? "") + (noisy() ? " stale" : ""),
    };
  };
  const sectionTarget = () => {
    const index = Math.floor(random() * meaning.sections.length);
    return {
      index,
      name: (meaning.sections[index] ?? "") + (noisy() ? " stale" : ""),
    };
  };
  const kind = pick(TIER2_KINDS);
  switch (kind) {
    case "moveTask":
      return meaning.tasks.length === 0
        ? null
        : { kind, target: taskTarget(), direction: pick(DIRECTIONS) };
    case "moveTaskToSection":
      return meaning.tasks.length === 0 || meaning.sections.length === 0
        ? null
        : {
            kind,
            target: taskTarget(),
            sectionIndex: Math.floor(random() * meaning.sections.length),
          };
    case "moveSection":
      return meaning.sections.length === 0
        ? null
        : { kind, target: sectionTarget(), direction: pick(DIRECTIONS) };
    case "duplicateTask":
      return meaning.tasks.length === 0 ? null : { kind, target: taskTarget() };
    case "setAxisFormat":
      return {
        kind,
        format: noisy() ? pick(ODD_AXIS_FORMATS) : pick(AXIS_FORMATS),
      };
    case "setExcludes":
      return {
        kind,
        tokens: noisy() ? pick(ODD_EXCLUDE_SETS) : pick(EXCLUDE_SETS),
      };
    case "clearExcludes":
      return { kind };
    case "addLink":
      return meaning.tasks.length === 0
        ? null
        : {
            kind,
            target: taskTarget(),
            url: noisy() ? pick(ODD_URLS) : pick(URLS),
          };
    case "removeLink":
      return meaning.tasks.length === 0 ? null : { kind, target: taskTarget() };
  }
}
