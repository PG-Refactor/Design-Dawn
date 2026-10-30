// @vitest-environment jsdom
// The sequence operations (src/domain/diagram/sequence/sequence-operations.ts) against the
// real Mermaid library (12.1.0): the Tier 1 scenarios of the earlier research (what a naive
// hand-made edit did, and what the editor does instead) and seeded random operation
// sequences. For every plan that is handed out, Mermaid itself must accept the new text,
// read it as the meaning the operation promised, and the app must be able to draw it; the
// edits must be undoable to the exact old text.
import { beforeAll, describe, expect, it } from "vitest";
import { SEQUENCE_ARROWS } from "../../domain/diagram/sequence/sequence-config";
import type {
  SequenceItemMeaning,
  SequenceMeaning,
} from "../../domain/diagram/sequence/sequence-meaning";
import {
  prepareSequence,
  type SequenceItemTarget,
  targetOfItem,
} from "../../domain/diagram/sequence/sequence-operation-support";
import {
  planSequenceOperation,
  type SequenceOperation,
} from "../../domain/diagram/sequence/sequence-operations";
import { applyTextEdits } from "../../domain/diagram/text-edit";
import { seededRandom } from "./test-support/flowchart-generator";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";
import {
  comparableOf,
  firstDifference,
} from "./test-support/sequence-comparison";
import {
  checkPlanAgainstMermaid,
  mermaidSays,
} from "./test-support/sequence-plan-check";
import { loadSequenceScenarios } from "./test-support/sequence-scenarios";

beforeAll(installFakeSvgMeasurement);

const TEST_TIMEOUT_MS = 600_000;

function targetOf(
  source: string,
  predicate: (item: SequenceItemMeaning) => boolean,
): SequenceItemTarget {
  const prepared = prepareSequence(source);
  if (!prepared.ok) throw new Error(prepared.error.detail);
  const index = prepared.value.meaning.items.findIndex(predicate);
  const item = prepared.value.meaning.items[index];
  if (item === undefined) throw new Error("no such entry");
  return targetOfItem(index, item);
}
const message = (text: string) => (item: SequenceItemMeaning) =>
  item.kind === "message" && item.text === text;
const note = (text: string) => (item: SequenceItemMeaning) =>
  item.kind === "note" && item.text === text;
const block = (text: string) => (item: SequenceItemMeaning) =>
  (item.kind === "blockStart" || item.kind === "branch") && item.text === text;

// What the editor is expected to do with a scenario's intent.
type Outcome =
  | { readonly kind: "plan"; readonly operation: SequenceOperation }
  // The editor refuses; `reason` is the first word of the error detail, or the error kind.
  | {
      readonly kind: "refuse";
      readonly reason: string;
      readonly operation: SequenceOperation;
    };

const plan = (operation: SequenceOperation): Outcome => ({
  kind: "plan",
  operation,
});
const refuse = (reason: string, operation: SequenceOperation): Outcome => ({
  kind: "refuse",
  reason,
  operation,
});
// The naive edit of the research wrote `<` and `>` as `#lt;` / `#gt;`, which Mermaid reads
// differently from raw text; the editor writes them raw (measured to be read unchanged), so
// for this scenario the naive text is not a failure of the same kind.
const NAIVE_IS_DIFFERENT_ON_PURPOSE: ReadonlySet<string> = new Set(["SQE-M08"]);
const NOT_EDITABLE = "diagramNotEditable";
const ANY: SequenceOperation = { kind: "setTitle", title: "x" };

// The intent of each Tier 1 scenario, written as a typed operation. Scenarios of Tier 2
// operations (delete / reorder participants, swap direction, duplicate, wrap / unwrap /
// add / delete branch, box edits) are not here.
const INTENTS: Readonly<Record<string, (source: string) => Outcome>> = {
  "SQE-P01": () =>
    plan({
      kind: "addParticipant",
      participantKind: "participant",
      label: "Dan",
      id: "D",
    }),
  "SQE-P02": () =>
    plan({
      kind: "addParticipant",
      participantKind: "participant",
      label: "Dan",
      id: "D",
    }),
  "SQE-P03": () =>
    plan({
      kind: "addParticipant",
      participantKind: "actor",
      label: "Dan",
      id: "D",
    }),
  "SQE-P04": () =>
    plan({
      kind: "addParticipant",
      participantKind: "participant",
      label: "Ops;Team",
      id: "D",
    }),
  "SQE-P05": () =>
    plan({
      kind: "addParticipant",
      participantKind: "participant",
      label: "Dev#1",
      id: "D",
    }),
  "SQE-P06": () =>
    refuse("directive", {
      kind: "addParticipant",
      participantKind: "participant",
      label: 'X%%{init: {"theme":"dark"}}%%Y',
      id: "D",
    }),
  "SQE-P07": () =>
    plan({
      kind: "renameParticipantLabel",
      participantId: "A",
      label: "Alicia",
    }),
  "SQE-P08": () =>
    plan({
      kind: "renameParticipantLabel",
      participantId: "A",
      label: "Alicia",
    }),
  "SQE-P09": () =>
    plan({
      kind: "renameParticipantLabel",
      participantId: "A",
      label: "Alice",
    }),
  "SQE-P10": () =>
    plan({
      kind: "changeParticipantKind",
      participantId: "A",
      participantKind: "actor",
    }),
  "SQE-P11": () =>
    refuse(NOT_EDITABLE, {
      kind: "renameParticipantLabel",
      participantId: "A",
      label: "Store",
    }),
  "SQE-P19": () =>
    refuse(NOT_EDITABLE, {
      kind: "renameParticipantLabel",
      participantId: "A",
      label: "Alicia",
    }),
  "SQE-P20": () =>
    refuse(NOT_EDITABLE, {
      kind: "renameParticipantLabel",
      participantId: "A",
      label: "Alicia",
    }),
  "SQE-M01": () =>
    plan({
      kind: "addMessage",
      from: "B",
      to: "A",
      arrow: "-->>",
      text: "Later",
    }),
  "SQE-M02": () =>
    plan({
      kind: "addMessage",
      from: "B",
      to: "A",
      arrow: "-->>",
      text: "Later",
    }),
  "SQE-M03": (s) =>
    plan({
      kind: "addMessage",
      from: "U",
      to: "S",
      arrow: "->>",
      text: "ack",
      after: targetOf(s, message("200")),
    }),
  "SQE-M04": () =>
    plan({
      kind: "addMessage",
      from: "B",
      to: "A",
      arrow: "-->>",
      text: "a; b",
    }),
  "SQE-M05": () =>
    plan({
      kind: "addMessage",
      from: "B",
      to: "A",
      arrow: "-->>",
      text: "item #5",
    }),
  "SQE-M06": () =>
    refuse("wrapPrefix", {
      kind: "addMessage",
      from: "B",
      to: "A",
      arrow: "-->>",
      text: "wrap: now",
    }),
  "SQE-M07": () =>
    plan({
      kind: "addMessage",
      from: "B",
      to: "A",
      arrow: "-->>",
      text: "l1\nl2",
    }),
  "SQE-M08": () =>
    plan({
      kind: "addMessage",
      from: "B",
      to: "A",
      arrow: "-->>",
      text: "x<y>z",
    }),
  "SQE-M09": () => refuse(NOT_EDITABLE, ANY),
  "SQE-M10": () => refuse(NOT_EDITABLE, ANY),
  "SQE-M11": (s) =>
    plan({
      kind: "editMessageText",
      target: targetOf(s, message("call")),
      text: "call2",
    }),
  "SQE-M12": (s) =>
    plan({
      kind: "editMessageText",
      target: targetOf(s, message("x")),
      text: "y",
    }),
  "SQE-M13": (s) =>
    plan({
      kind: "editMessageText",
      target: targetOf(s, message("x %% tail")),
      text: "y",
    }),
  "SQE-M14": (s) =>
    plan({
      kind: "changeArrow",
      target: targetOf(s, message("call a->>b")),
      arrow: "-->>",
    }),
  "SQE-M15": (s) =>
    plan({
      kind: "changeArrow",
      target: targetOf(s, message("Hello")),
      arrow: "<<->>",
    }),
  "SQE-M16": () => refuse(NOT_EDITABLE, ANY),
  "SQE-M19": (s) =>
    plan({ kind: "deleteMessage", target: targetOf(s, message("Hi")) }),
  "SQE-M20": (s) =>
    refuse("activationSign", {
      kind: "deleteMessage",
      target: targetOf(s, message("call")),
    }),
  "SQE-M21": (s) =>
    refuse("activationSign", {
      kind: "deleteMessage",
      target: targetOf(s, message("r2")),
    }),
  "SQE-M22": (s) =>
    plan({ kind: "deleteMessage", target: targetOf(s, message("Bye")) }),
  "SQE-M23": (s) =>
    plan({ kind: "deleteMessage", target: targetOf(s, message("one")) }),
  "SQE-M24": (s) =>
    plan({
      kind: "moveMessage",
      target: targetOf(s, message("Hi")),
      direction: "down",
    }),
  "SQE-M25": (s) =>
    plan({
      kind: "moveMessage",
      target: targetOf(s, message("one")),
      direction: "down",
    }),
  "SQE-M26": (s) =>
    refuse("blockBoundary", {
      kind: "moveMessage",
      target: targetOf(s, message("req")),
      direction: "down",
    }),
  "SQE-M27": (s) =>
    refuse("blockBoundary", {
      kind: "moveMessage",
      target: targetOf(s, message("again")),
      direction: "down",
    }),
  "SQE-M28": () => refuse(NOT_EDITABLE, ANY),
  "SQE-M30": () => refuse(NOT_EDITABLE, ANY),
  "SQE-M31": () => refuse(NOT_EDITABLE, ANY),
  "SQE-M32": (s) =>
    plan({ kind: "deleteMessage", target: targetOf(s, message("two")) }),
  "SQE-M33": (s) =>
    plan({
      kind: "editMessageText",
      target: targetOf(s, message("one")),
      text: "uno",
    }),
  "SQE-M34": () =>
    refuse("participantNotFound", {
      kind: "addMessage",
      from: "A",
      to: "Z",
      arrow: "->>",
      text: "x",
    }),
  "SQE-N01": (s) =>
    plan({
      kind: "addNote",
      placement: "over",
      participants: ["A", "B"],
      text: "n",
      after: targetOf(s, message("Hello")),
    }),
  "SQE-N02": () =>
    plan({
      kind: "addNote",
      placement: "over",
      participants: ["A"],
      text: "a;b",
    }),
  "SQE-N03": (s) =>
    plan({
      kind: "editNoteText",
      target: targetOf(s, note("done")),
      text: "finished",
    }),
  "SQE-N04": (s) =>
    plan({
      kind: "changeNotePlacement",
      target: targetOf(s, note("done")),
      placement: "leftOf",
    }),
  "SQE-N05": (s) =>
    plan({ kind: "deleteNote", target: targetOf(s, note("n")) }),
  "SQE-N06": () =>
    refuse("participantNotFound", {
      kind: "addNote",
      placement: "over",
      participants: ["Z"],
      text: "n",
    }),
  "SQE-N07": () => refuse(NOT_EDITABLE, ANY),
  "SQE-B01": (s) =>
    plan({
      kind: "editBlockText",
      target: targetOf(s, block("retry")),
      text: "retry 3x",
    }),
  "SQE-B02": (s) =>
    plan({
      kind: "editBlockText",
      target: targetOf(s, block("")),
      text: "fail",
    }),
  "SQE-B03": (s) =>
    plan({
      kind: "editBlockText",
      target: targetOf(s, block("retry")),
      text: "a;b #1",
    }),
  "SQE-B12": () => refuse(NOT_EDITABLE, ANY),
  "SQE-X01": () => plan({ kind: "setAutonumber", enabled: true }),
  "SQE-X02": () => plan({ kind: "setAutonumber", enabled: false }),
  "SQE-X03": () => plan({ kind: "setTitle", title: "New" }),
  "SQE-X04": () =>
    plan({
      kind: "addMessage",
      from: "B",
      to: "A",
      arrow: "-->>",
      text: "Later",
    }),
  "SQE-X05": () =>
    plan({
      kind: "addMessage",
      from: "B",
      to: "A",
      arrow: "-->>",
      text: "Later",
    }),
  "SQE-X06": (s) =>
    plan({ kind: "deleteMessage", target: targetOf(s, message("again")) }),
};

describe("sequence operations: research scenarios against mermaid 12.1.0", () => {
  const scenarios = loadSequenceScenarios();

  it("has the scenarios the table below is about", () => {
    expect(scenarios.length).toBe(79);
    const unknown = Object.keys(INTENTS).filter(
      (id) => !scenarios.some((scenario) => scenario.id === id),
    );
    expect(unknown).toEqual([]);
  });

  it(
    "plans or refuses every Tier 1 scenario as intended",
    async () => {
      const problems: string[] = [];
      let planned = 0;
      let refused = 0;
      let naiveWrong = 0;
      for (const scenario of scenarios) {
        const intent = INTENTS[scenario.id];
        if (intent === undefined) continue;
        const outcome = intent(scenario.source);
        const result = planSequenceOperation(
          scenario.source,
          outcome.operation,
        );
        if (outcome.kind === "plan") {
          if (!result.ok) {
            problems.push(`${scenario.id}: refused ${result.error.detail}`);
            continue;
          }
          planned += 1;
          const problem = await checkPlanAgainstMermaid(
            scenario.id,
            scenario.source,
            outcome.operation,
          );
          if (problem !== null) problems.push(problem);
          if (
            scenario.naiveGate !== "PASS" &&
            !NAIVE_IS_DIFFERENT_ON_PURPOSE.has(scenario.id)
          ) {
            // The naive edit of the research really was wrong in this version of Mermaid.
            const naive = await mermaidSays(scenario.naiveCandidate);
            const expected = comparableOf(result.value.expected);
            if (naive === null || firstDifference(expected, naive) !== null) {
              naiveWrong += 1;
            } else {
              problems.push(
                `${scenario.id}: the naive edit is now correct (${scenario.naiveGate} in the research)`,
              );
            }
          }
        } else {
          if (result.ok) {
            problems.push(
              `${scenario.id}: planned, expected a refusal (${outcome.reason})`,
            );
            continue;
          }
          refused += 1;
          const reason =
            result.error.kind === "diagramNotEditable"
              ? NOT_EDITABLE
              : (result.error.detail.split(":")[0] ?? "");
          if (reason !== outcome.reason) {
            problems.push(
              `${scenario.id}: refused with ${reason}, expected ${outcome.reason}`,
            );
          }
        }
      }
      expect(problems).toEqual([]);
      expect({ planned, refused, naiveWrong }).toEqual({
        planned: 42,
        refused: 19,
        naiveWrong: 26,
      });
    },
    TEST_TIMEOUT_MS,
  );
});

// ---- seeded random operation sequences

const BASE_DIAGRAMS: readonly string[] = [
  "sequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: Hello\n    B-->>A: Hi\n    A->>B: Bye\n",
  "sequenceDiagram\n    A->>+B: call\n    B->>+C: inner\n    C-->>-B: r1\n    B-->>-A: r2\n    Note over A,B: done\n",
  "sequenceDiagram\n    participant U as User\n    participant S as Server\n    U->>S: req\n    alt ok\n        S-->>U: 200\n    else fail\n        S-->>U: 500\n    end\n    loop retry\n        U->>S: again\n    end\n",
  "sequenceDiagram\n    A->>B: one\n    C->>D: two; A->>D: three\n    Note right of C: n # c\n",
  "sequenceDiagram\n\tactor U\n\tparticipant S\n\tU-)S: ping\r\n",
];
const TEXTS = [
  "hello",
  "a: b",
  "x\ny",
  "50%",
  "a; b",
  "item #5",
  "#59; literal",
  "",
  "日本語",
  "a -> b",
  "a %% b",
  "<b>bold</b>",
  "back\\slash",
  "%starts",
  'quote "q"',
  "wrap: no",
  "a\tb",
  "x%%{y}%%",
];
const LABELS = ["Alice", "The Server", "Z (x)", "ユーザー様", "a;b", "#1", ""];
const FIXED_IDS = ["N1", "Web", "end", "x y", "ユ"];

function randomOperation(
  random: () => number,
  meaning: SequenceMeaning,
): SequenceOperation {
  const pick = <T>(values: readonly T[]): T =>
    values[Math.floor(random() * values.length)] as T;
  const ids = meaning.participants.map((participant) => participant.id);
  const entry = (
    kinds: readonly SequenceItemMeaning["kind"][],
  ): SequenceItemTarget | undefined => {
    const candidates = meaning.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => kinds.includes(item.kind));
    if (candidates.length === 0) return undefined;
    const chosen = pick(candidates);
    return targetOfItem(chosen.index, chosen.item);
  };
  const stale: SequenceItemTarget = { index: 0, fingerprint: "stale" };
  const after = random() < 0.5 ? entry(["message", "note"]) : undefined;
  switch (Math.floor(random() * 15)) {
    case 0:
      return {
        kind: "addParticipant",
        participantKind: pick(["participant", "actor"] as const),
        label: pick(LABELS),
        ...(random() < 0.3 ? { id: pick(FIXED_IDS) } : {}),
      };
    case 1:
      return {
        kind: "renameParticipantLabel",
        participantId: pick([...ids, "Q"]),
        label: pick(LABELS),
      };
    case 2:
      return {
        kind: "changeParticipantKind",
        participantId: pick(ids),
        participantKind: pick(["participant", "actor"] as const),
      };
    case 3:
    case 4:
      return {
        kind: "addMessage",
        from: pick([...ids, "Q"]),
        to: pick(ids),
        arrow: pick(SEQUENCE_ARROWS),
        text: pick(TEXTS),
        ...(after === undefined ? {} : { after }),
      };
    case 5:
      return {
        kind: "editMessageText",
        target: entry(["message"]) ?? stale,
        text: pick(TEXTS),
      };
    case 6:
      return {
        kind: "changeArrow",
        target: entry(["message"]) ?? stale,
        arrow: pick(SEQUENCE_ARROWS),
      };
    case 7:
      return { kind: "deleteMessage", target: entry(["message"]) ?? stale };
    case 8:
    case 9:
      return {
        kind: "moveMessage",
        target: entry(["message"]) ?? stale,
        direction: pick(["up", "down"] as const),
      };
    case 10: {
      const placement = pick(["leftOf", "rightOf", "over"] as const);
      return {
        kind: "addNote",
        placement,
        participants:
          placement === "over" && random() < 0.4
            ? [pick(ids), pick(ids)]
            : [pick(ids)],
        text: pick(TEXTS),
        ...(after === undefined ? {} : { after }),
      };
    }
    case 11:
      return random() < 0.5
        ? {
            kind: "editNoteText",
            target: entry(["note"]) ?? stale,
            text: pick(TEXTS),
          }
        : {
            kind: "changeNotePlacement",
            target: entry(["note"]) ?? stale,
            placement: pick(["leftOf", "rightOf", "over"] as const),
          };
    case 12:
      return random() < 0.5
        ? { kind: "deleteNote", target: entry(["note"]) ?? stale }
        : {
            kind: "editBlockText",
            target: entry(["blockStart", "branch"]) ?? stale,
            text: pick(TEXTS),
          };
    case 13:
      return { kind: "setAutonumber", enabled: random() < 0.5 };
    default:
      return { kind: "setTitle", title: pick(["", "Title", "A; B", "T #1"]) };
  }
}

describe("sequence operations: seeded random sequences against mermaid 12.1.0", () => {
  const SEEDS_PER_DIAGRAM = 12;
  const STEPS_PER_SEQUENCE = 12;

  it(
    "every plan is accepted, read and drawn by Mermaid as promised and undoable",
    async () => {
      const problems: string[] = [];
      let planned = 0;
      let refused = 0;
      const reasons = new Map<string, number>();
      for (const [diagramIndex, base] of BASE_DIAGRAMS.entries()) {
        for (let seed = 1; seed <= SEEDS_PER_DIAGRAM; seed += 1) {
          const random = seededRandom(diagramIndex * 1000 + seed);
          let source = base;
          for (let step = 0; step < STEPS_PER_SEQUENCE; step += 1) {
            const prepared = prepareSequence(source);
            if (!prepared.ok) {
              problems.push(
                `d${diagramIndex}s${seed}#${step}: lost editability ${prepared.error.detail}`,
              );
              break;
            }
            const operation = randomOperation(random, prepared.value.meaning);
            const label = `d${diagramIndex}s${seed}#${step} ${operation.kind}`;
            const result = planSequenceOperation(source, operation);
            if (!result.ok) {
              refused += 1;
              const reason = result.error.detail.split(":")[0] ?? "";
              reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
              continue;
            }
            planned += 1;
            const problem = await checkPlanAgainstMermaid(
              label,
              source,
              operation,
            );
            if (problem !== null) {
              problems.push(problem);
              break;
            }
            const applied = applyTextEdits(source, result.value.edits);
            if (applied.ok) source = applied.value.text;
          }
        }
      }
      expect(problems).toEqual([]);
      expect({ planned, refused }).toEqual({ planned: 510, refused: 210 });
      // Refusals are the editor's rules at work; a stale target (no entry of that kind in the
      // diagram) is the biggest group. A change in these numbers means a rule moved.
      expect(Object.fromEntries([...reasons].sort())).toEqual({
        activationSign: 26,
        atBoundary: 8,
        blockBoundary: 34,
        controlCharacter: 8,
        directive: 3,
        doublePercent: 1,
        emptyLabel: 3,
        invalidId: 8,
        noteParticipants: 4,
        participantCreatedLater: 2,
        participantNotFound: 32,
        reservedId: 3,
        targetMismatch: 58,
        targetNotFound: 8,
        wrapPrefix: 12,
      });
    },
    TEST_TIMEOUT_MS,
  );
});
