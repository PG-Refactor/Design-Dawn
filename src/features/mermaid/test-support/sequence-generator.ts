// TEST ONLY. A seeded generator of random sequence programs for the differential test
// (sequence-reader.real.dom.test.ts). It is a typed rewrite of the generator of the Step 9-7
// research (project-authored). The programs mix declarations, messages with all arrows and
// activation signs, notes, blocks with branches, `autonumber`, `create` / `destroy`, trailing
// comments and several statements per line; whether Mermaid accepts one is decided by
// Mermaid at test time, not by the generator.
import type { RandomSource } from "./flowchart-generator";

const IDS = ["A", "B", "C", "D", "ユーザー", "srv_1", "Web2"] as const;
const ARROWS = [
  "->>",
  "-->>",
  "->",
  "-->",
  "-x",
  "--x",
  "-)",
  "--)",
  "<<->>",
  "<<-->>",
] as const;
const TEXTS = [
  "hello",
  "a: b",
  "x<br/>y",
  "50%",
  "#59; semi",
  "",
  "go (now)",
  "日本語",
  "a -> b",
  "wrap: no",
  "x #35; y",
] as const;
const ALIASES = [
  "Alice",
  "The Server",
  "Z (x)",
  "ユーザー様",
  "a#59;b",
] as const;
const BLOCK_WORDS = [
  "loop",
  "alt",
  "opt",
  "par",
  "critical",
  "break",
  "rect",
] as const;
const BLOCK_LABELS = ["go", "a: b", "x#59;y", ""] as const;
const NOTE_PLACEMENTS = ["over", "left of", "right of"] as const;
const BRANCH_OF: Readonly<Record<string, string>> = {
  alt: "else",
  par: "and",
  critical: "option",
};

const MIN_STATEMENTS = 3;
const STATEMENT_SPREAD = 12;
const MAX_OPEN_BLOCKS = 3;
const FINAL_NEWLINE_CHANCE = 0.8;
// Thresholds on one uniform draw that choose the kind of the next statement.
const KIND_STEPS = [
  0.12, 0.55, 0.65, 0.72, 0.82, 0.88, 0.92, 0.94, 0.95, 0.96,
] as const;

export function generateSequenceProgram(random: RandomSource): string {
  const pick = <T>(values: readonly T[]): T =>
    values[Math.floor(random() * values.length)] as T;
  const lines: string[] = ["sequenceDiagram"];
  const open: string[] = [];
  // What the program has mentioned so far and which participants are active, so the program
  // is mostly one Mermaid accepts: `activate` needs a known participant and `-` /
  // `deactivate` an open activation.
  const known = new Set<string>();
  const active = new Map<string, number>();
  const mention = (...ids: string[]): void => {
    for (const id of ids) known.add(id);
  };
  const count = MIN_STATEMENTS + Math.floor(random() * STATEMENT_SPREAD);
  for (let step = 0; step < count; step += 1) {
    const indent = "  ".repeat(1 + open.length);
    const draw = random();
    if (draw < (KIND_STEPS[0] as number)) {
      const declared = pick(IDS);
      mention(declared);
      lines.push(
        `${indent}${pick(["participant", "actor"])} ${declared}${random() < 0.5 ? ` as ${pick(ALIASES)}` : ""}`,
      );
    } else if (draw < (KIND_STEPS[1] as number)) {
      const sender = pick(IDS);
      const receiver = pick(IDS);
      mention(sender, receiver);
      let sign = random() < 0.15 ? "+" : "";
      if (sign === "" && random() < 0.1 && (active.get(sender) ?? 0) > 0) {
        sign = "-";
      }
      if (sign === "+") active.set(receiver, (active.get(receiver) ?? 0) + 1);
      if (sign === "-") active.set(sender, (active.get(sender) ?? 0) - 1);
      const gap = random() < 0.3 ? "" : " ";
      const joinedFrom = pick(IDS);
      const joinedTo = pick(IDS);
      const joined = random() < 0.05 ? `; ${joinedFrom}->>${joinedTo}: j` : "";
      lines.push(
        `${indent}${sender}${gap}${pick(ARROWS)}${sign}${gap}${receiver}${random() < 0.95 ? `: ${pick(TEXTS)}` : ""}${random() < 0.06 ? " # c" : ""}${joined}`,
      );
      if (joined !== "") mention(joinedFrom, joinedTo);
    } else if (draw < (KIND_STEPS[2] as number)) {
      const placement = pick(NOTE_PLACEMENTS);
      const first = pick(IDS);
      const second = placement === "over" && random() < 0.3 ? pick(IDS) : null;
      mention(first, ...(second === null ? [] : [second]));
      lines.push(
        `${indent}Note ${placement} ${first}${second === null ? "" : `,${second}`}: ${pick(TEXTS)}`,
      );
    } else if (draw < (KIND_STEPS[3] as number)) {
      const target = pick([...known, ...IDS.slice(0, 1)]);
      if (known.has(target)) {
        const turnOff = (active.get(target) ?? 0) > 0 && random() < 0.5;
        active.set(target, (active.get(target) ?? 0) + (turnOff ? -1 : 1));
        lines.push(`${indent}${turnOff ? "deactivate" : "activate"} ${target}`);
      }
    } else if (
      draw < (KIND_STEPS[4] as number) &&
      open.length < MAX_OPEN_BLOCKS
    ) {
      const word = pick(BLOCK_WORDS);
      open.push(word);
      lines.push(
        `${indent}${word}${random() < 0.8 ? ` ${pick(BLOCK_LABELS)}` : ""}`,
      );
    } else if (draw < (KIND_STEPS[5] as number) && open.length > 0) {
      const word = open[open.length - 1] as string;
      const branch = BRANCH_OF[word];
      if (branch !== undefined) {
        lines.push(`${indent}${branch}${random() < 0.7 ? " br" : ""}`);
        if (random() < 0.2) {
          mention("A", "B");
          lines.push(`${indent}A->>B: inbranch`);
        }
      }
    } else if (draw < (KIND_STEPS[6] as number) && open.length > 0) {
      open.pop();
      lines.push(`${"  ".repeat(1 + open.length)}end`);
    } else if (draw < (KIND_STEPS[7] as number)) {
      lines.push(
        `${indent}autonumber${random() < 0.5 ? ` ${1 + Math.floor(random() * 20)}` : ""}`,
      );
    } else if (draw < (KIND_STEPS[8] as number)) {
      const created = pick(IDS);
      mention(created);
      lines.push(
        `${indent}create participant ${created}${random() < 0.3 ? ` as ${pick(ALIASES)}` : ""}`,
      );
      const creator = pick(IDS);
      mention(creator);
      lines.push(`${indent}${creator}->>${created}: new`);
    } else if (draw < (KIND_STEPS[9] as number)) {
      const destroyed = pick(IDS);
      lines.push(`${indent}destroy ${destroyed}`);
      lines.push(`${indent}${destroyed}-->>${pick(IDS)}: bye`);
    } else {
      lines.push(`${indent}%% comment`);
    }
  }
  while (open.length > 0) {
    open.pop();
    lines.push(`${"  ".repeat(1 + open.length)}end`);
  }
  return lines.join("\n") + (random() < FINAL_NEWLINE_CHANCE ? "\n" : "");
}
