// TEST ONLY. A seeded generator of random gantt programs for the differential test
// (gantt-reader.real.dom.test.ts): a typed rewrite of the generator of the Step 9-7 research
// (project-authored). It mixes valid and invalid dates, durations, references, tags, field
// counts, comments, clicks and awkward names; whether Mermaid accepts one is decided by
// Mermaid at test time, not by the generator.
import type { RandomSource } from "./flowchart-generator";

const IDS = ["a1", "b1", "c1", "d1", "x-1", "t_2", "m1", "v1"] as const;
const TITLES = ["Plan", "Release plan", "設計"] as const;
const ODD_TITLES = ["A: b", "X;Y", "t #1"] as const;
const SECTION_NAMES = ["A", "Build phase", "設計", "C"] as const;
const ODD_SECTION_NAMES = ["a:b", "A"] as const;
const TASK_NAMES = ["Task", "Spec doc", "日本語", "Review", "Plan x"] as const;
const ODD_TASK_NAMES = [
  "Review: x",
  "T;1",
  "T #2",
  "excludes plan",
  "5% rule",
  "a%b",
] as const;
const DATES = ["2024-01-01", "2024-01-10", "2024-02-29", "2023-12-31"] as const;
const ODD_DATES = ["2024-02-30", "2024-1-5", "2024/01/05"] as const;
const LENGTHS = ["2d", "1w", "0d", "3h", "30m", "2024-01-20", "4d"] as const;
const ODD_LENGTHS = ["5 days", "10D", "1.5d", "2M"] as const;
const ODD_RATE = 0.06;
const TAGS = ["done", "active", "crit", "milestone", "vert"] as const;
const COMMENTS = ["  %% c", "  % c", ""] as const;
const EXCLUDES = ["weekends", "saturday", "2024-01-03"] as const;

const MIN_TASKS = 2;
const TASK_SPREAD = 10;

export function generateGanttProgram(random: RandomSource): string {
  const pick = <T>(values: readonly T[]): T =>
    values[Math.floor(random() * values.length)] as T;
  const lines = ["gantt"];
  if (random() < 0.97) lines.push("  dateFormat YYYY-MM-DD");
  if (random() < 0.3) {
    lines.push(
      `  title ${random() < ODD_RATE ? pick(ODD_TITLES) : pick(TITLES)}`,
    );
  }
  if (random() < 0.2) lines.push("  axisFormat %m/%d");
  if (random() < 0.2) lines.push(`  excludes ${pick(EXCLUDES)}`);
  const count = MIN_TASKS + Math.floor(random() * TASK_SPREAD);
  const used: string[] = [];
  for (let step = 0; step < count; step += 1) {
    const roll = random();
    if (roll < 0.15) {
      lines.push(
        `  section ${random() < ODD_RATE ? pick(ODD_SECTION_NAMES) : pick(SECTION_NAMES)}`,
      );
      continue;
    }
    if (roll < 0.2) {
      lines.push(pick(COMMENTS));
      continue;
    }
    if (roll < 0.25 && used.length > 0) {
      lines.push(`  click ${pick(used)} href "https://e.example/${step}"`);
      continue;
    }
    const tags: string[] = [];
    while (random() < 0.25) {
      const tag = pick(TAGS);
      if (!tags.includes(tag) || random() < ODD_RATE) tags.push(tag);
    }
    const date = () => (random() < ODD_RATE ? pick(ODD_DATES) : pick(DATES));
    const length = () =>
      random() < ODD_RATE ? pick(ODD_LENGTHS) : pick(LENGTHS);
    const start =
      random() < 0.5 || used.length === 0
        ? date()
        : `after ${pick(used)}${random() < 0.2 ? ` ${pick(used)}` : ""}`;
    // A repeated id is what Mermaid binds to the last task; rare on purpose.
    const fresh = IDS.filter((candidate) => !used.includes(candidate));
    const id =
      fresh.length > 0 && random() >= ODD_RATE ? pick(fresh) : pick(IDS);
    const form = random();
    const data =
      form < 0.55
        ? [id, start, length()]
        : form < 0.8
          ? [start, length()]
          : form < 0.95
            ? [length()]
            : form < 0.975
              ? [id, start, length(), "extra"]
              : [id, "after zzz", length()];
    const hash = random() < 0.02 ? " # c" : "";
    const percent = random() < 0.02 ? " %% c" : "";
    const name = random() < ODD_RATE ? pick(ODD_TASK_NAMES) : pick(TASK_NAMES);
    lines.push(`  ${name} :${[...tags, ...data].join(", ")}${hash}${percent}`);
    if (data.length === 3 && data[0] === id) used.push(id);
  }
  return `${lines.join("\n")}\n`;
}
