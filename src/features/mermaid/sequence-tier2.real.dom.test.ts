// @vitest-environment jsdom
// The Tier 2 sequence operations against the real Mermaid
// library (12.1.0): fixed cases for every operation, the arrow / sign grid of the activation
// toggle, and seeded random operation sequences that mix Tier 1 and Tier 2 operations. For
// every plan that is handed out, Mermaid itself must accept the new text, read it as the
// meaning the operation promised, and the app must be able to draw it; the edits must be
// undoable to the exact old text.
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
const block = (text: string) => (item: SequenceItemMeaning) =>
  (item.kind === "blockStart" || item.kind === "branch") && item.text === text;

const SR1 =
  "sequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: Hello\n    B-->>A: Hi\n    A->>B: Bye\n";
const SR2 =
  "sequenceDiagram\n    A->>+B: call\n    B->>+C: inner\n    C-->>-B: r1\n    B-->>-A: r2\n    Note over A,B: done\n";
const SR3 =
  "sequenceDiagram\n    participant U as User\n    participant S as Server\n    U->>S: req\n    alt ok\n        S-->>U: 200\n    else fail\n        S-->>U: 500\n    end\n    loop retry\n        U->>S: again\n    end\n";
const SR4 =
  "sequenceDiagram\n    A->>B: one\n    C->>D: two; A->>D: three\n    Note right of C: n # c\n";
const SR5 = "sequenceDiagram\n\tactor U\n\tparticipant S\n\tU-)S: ping\r\n";
const SR6 =
  "sequenceDiagram\n    participant A\n    participant B\n    participant C\n    A->>B: x\n    activate B\n    B->>C: y\n    deactivate B\n    Note over C: z\n";
const SR7 =
  "sequenceDiagram\n    A->>B: one\n    loop L\n        B->>C: two\n        alt a\n            C->>A: three\n        else b\n            A->>C: four\n        end\n        par p\n            A->>B: five\n        and q\n            B->>A: six\n        end\n    end\n";

interface Case {
  readonly label: string;
  readonly source: string;
  readonly operation: SequenceOperation;
}

const m = (source: string, text: string) => targetOf(source, message(text));
const b = (source: string, text: string) => targetOf(source, block(text));

const CASES: readonly Case[] = [
  // deleteParticipant
  {
    label: "delete B (declared) of SR1",
    source: SR1,
    operation: { kind: "deleteParticipant", participantId: "B" },
  },
  {
    label: "delete A (declared) of SR1",
    source: SR1,
    operation: { kind: "deleteParticipant", participantId: "A" },
  },
  {
    label: "delete implicit C of SR2",
    source: SR2,
    operation: { kind: "deleteParticipant", participantId: "C" },
  },
  {
    label: "delete implicit A of SR4 (statement sharing a line)",
    source: SR4,
    operation: { kind: "deleteParticipant", participantId: "A" },
  },
  {
    label: "delete B of SR6 with activate / deactivate",
    source: SR6,
    operation: { kind: "deleteParticipant", participantId: "B" },
  },
  {
    label: "delete C of SR6 with a note",
    source: SR6,
    operation: { kind: "deleteParticipant", participantId: "C" },
  },
  {
    label: "delete S of SR3 empties blocks",
    source: SR3,
    operation: { kind: "deleteParticipant", participantId: "S" },
  },
  {
    label: "delete implicit B of SR7 keeps C and A columns",
    source: SR7,
    operation: { kind: "deleteParticipant", participantId: "B" },
  },
  {
    label: "delete U of SR5 (tabs, CRLF)",
    source: SR5,
    operation: { kind: "deleteParticipant", participantId: "U" },
  },
  // reorderParticipants
  {
    label: "B left in SR1",
    source: SR1,
    operation: {
      kind: "reorderParticipants",
      participantId: "B",
      direction: "left",
    },
  },
  {
    label: "A right in SR1",
    source: SR1,
    operation: {
      kind: "reorderParticipants",
      participantId: "A",
      direction: "right",
    },
  },
  {
    label: "C left in SR2 (all implicit)",
    source: SR2,
    operation: {
      kind: "reorderParticipants",
      participantId: "C",
      direction: "left",
    },
  },
  {
    label: "A right in SR2 (all implicit)",
    source: SR2,
    operation: {
      kind: "reorderParticipants",
      participantId: "A",
      direction: "right",
    },
  },
  {
    label: "D left in SR4",
    source: SR4,
    operation: {
      kind: "reorderParticipants",
      participantId: "D",
      direction: "left",
    },
  },
  {
    label: "C left in SR4",
    source: SR4,
    operation: {
      kind: "reorderParticipants",
      participantId: "C",
      direction: "left",
    },
  },
  {
    label: "S left in SR5 (tabs)",
    source: SR5,
    operation: {
      kind: "reorderParticipants",
      participantId: "S",
      direction: "left",
    },
  },
  {
    label: "C left in SR6",
    source: SR6,
    operation: {
      kind: "reorderParticipants",
      participantId: "C",
      direction: "left",
    },
  },
  {
    label: "C left in SR7 (implicit inside a block)",
    source: SR7,
    operation: {
      kind: "reorderParticipants",
      participantId: "C",
      direction: "left",
    },
  },
  // wrapInBlock
  {
    label: "wrap messages 2-3 of SR1 in loop",
    source: SR1,
    operation: {
      kind: "wrapInBlock",
      from: m(SR1, "Hi"),
      to: m(SR1, "Bye"),
      block: "loop",
      text: "again",
    },
  },
  {
    label: "wrap one message in opt (empty text)",
    source: SR1,
    operation: {
      kind: "wrapInBlock",
      from: m(SR1, "Hello"),
      to: m(SR1, "Hello"),
      block: "opt",
      text: "",
    },
  },
  {
    label: "wrap the whole alt of SR3 in critical",
    source: SR3,
    operation: {
      kind: "wrapInBlock",
      from: b(SR3, "ok"),
      to: b(SR3, "ok"),
      block: "critical",
      text: "c; d",
    },
  },
  {
    label: "wrap req and the alt of SR3 in par",
    source: SR3,
    operation: {
      kind: "wrapInBlock",
      from: m(SR3, "req"),
      to: b(SR3, "ok"),
      block: "par",
      text: "p",
    },
  },
  {
    label: "wrap inside the loop of SR7 in break",
    source: SR7,
    operation: {
      kind: "wrapInBlock",
      from: m(SR7, "two"),
      to: b(SR7, "a"),
      block: "break",
      text: "br",
    },
  },
  {
    label: "wrap in a branch of SR7 in alt",
    source: SR7,
    operation: {
      kind: "wrapInBlock",
      from: m(SR7, "five"),
      to: m(SR7, "five"),
      block: "alt",
      text: "x",
    },
  },
  {
    label: "wrap in SR5 (tabs, CRLF)",
    source: SR5,
    operation: {
      kind: "wrapInBlock",
      from: m(SR5, "ping"),
      to: m(SR5, "ping"),
      block: "loop",
      text: "forever",
    },
  },
  {
    label: "wrap a note and a message with activations",
    source: SR2,
    operation: {
      kind: "wrapInBlock",
      from: m(SR2, "inner"),
      to: m(SR2, "r1"),
      block: "loop",
      text: "in",
    },
  },
  // unwrapBlock
  {
    label: "unwrap the loop of SR3",
    source: SR3,
    operation: { kind: "unwrapBlock", target: b(SR3, "retry") },
  },
  {
    label: "unwrap the loop of SR7 (nested blocks inside)",
    source: SR7,
    operation: { kind: "unwrapBlock", target: b(SR7, "L") },
  },
  // addBranch
  {
    label: "add else at the end of the alt of SR3",
    source: SR3,
    operation: { kind: "addBranch", target: b(SR3, "ok"), text: "third" },
  },
  {
    label: "add else behind the first message of the alt",
    source: SR3,
    operation: {
      kind: "addBranch",
      target: b(SR3, "ok"),
      text: "mid",
      after: m(SR3, "200"),
    },
  },
  {
    label: "add and to the par of SR7",
    source: SR7,
    operation: { kind: "addBranch", target: b(SR7, "p"), text: "" },
  },
  {
    label: "add else behind the nested par (end entry) in SR7",
    source: SR7,
    operation: {
      kind: "addBranch",
      target: b(SR7, "a"),
      text: "z",
      after: m(SR7, "three"),
    },
  },
  // deleteBranch
  {
    label: "delete else of the alt of SR3",
    source: SR3,
    operation: { kind: "deleteBranch", target: b(SR3, "fail") },
  },
  {
    label: "delete and of the par of SR7",
    source: SR7,
    operation: { kind: "deleteBranch", target: b(SR7, "q") },
  },
  {
    label: "delete else b of SR7",
    source: SR7,
    operation: { kind: "deleteBranch", target: b(SR7, "b") },
  },
  // setMessageActivation
  {
    label: "activate the receiver of Hello",
    source: SR1,
    operation: {
      kind: "setMessageActivation",
      target: m(SR1, "Hello"),
      sign: "+",
    },
  },
  {
    label: "remove the minus of r2",
    source: SR2,
    operation: {
      kind: "setMessageActivation",
      target: m(SR2, "r2"),
      sign: null,
    },
  },
  {
    label: "remove the minus of r1",
    source: SR2,
    operation: {
      kind: "setMessageActivation",
      target: m(SR2, "r1"),
      sign: null,
    },
  },
  {
    label: "plus to minus is not paired (r2 plus)",
    source: SR2,
    operation: {
      kind: "setMessageActivation",
      target: m(SR2, "r2"),
      sign: "+",
    },
  },
  // duplicateMessage
  {
    label: "duplicate Hi",
    source: SR1,
    operation: { kind: "duplicateMessage", target: m(SR1, "Hi") },
  },
  {
    label: "duplicate a plus message",
    source: SR2,
    operation: { kind: "duplicateMessage", target: m(SR2, "call") },
  },
  {
    label: "duplicate a minus message",
    source: SR2,
    operation: { kind: "duplicateMessage", target: m(SR2, "r1") },
  },
  {
    label: "duplicate inside a block",
    source: SR3,
    operation: { kind: "duplicateMessage", target: m(SR3, "500") },
  },
  {
    label: "duplicate with tabs and CRLF",
    source: SR5,
    operation: { kind: "duplicateMessage", target: m(SR5, "ping") },
  },
];

describe("sequence Tier 2 operations: fixed cases against mermaid 12.1.0", () => {
  it(
    "every planned case is accepted, read and drawn by Mermaid as promised and undoable",
    async () => {
      const problems: string[] = [];
      const refused: string[] = [];
      for (const testCase of CASES) {
        const plan = planSequenceOperation(testCase.source, testCase.operation);
        if (!plan.ok) {
          refused.push(`${testCase.label}: ${plan.error.detail}`);
          continue;
        }
        const problem = await checkPlanAgainstMermaid(
          testCase.label,
          testCase.source,
          testCase.operation,
        );
        if (problem !== null) problems.push(problem);
      }
      expect(problems).toEqual([]);
      expect(refused).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("sequence Tier 2 operations: the activation toggle for every arrow", () => {
  it(
    "writes + and - after every arrow so that Mermaid reads them as promised",
    async () => {
      const problems: string[] = [];
      let planned = 0;
      for (const arrow of SEQUENCE_ARROWS) {
        const plain = `sequenceDiagram\n  A${arrow}B: first\n  B${arrow}A: second\n`;
        const opened = `sequenceDiagram\n  A${arrow}+B: first\n  B${arrow}A: second\n`;
        const closed = `sequenceDiagram\n  A${arrow}+B: first\n  B${arrow}-A: second\n`;
        const cases: Case[] = [
          {
            label: `${arrow} plus`,
            source: plain,
            operation: {
              kind: "setMessageActivation",
              target: m(plain, "first"),
              sign: "+",
            },
          },
          {
            label: `${arrow} minus`,
            source: opened,
            operation: {
              kind: "setMessageActivation",
              target: m(opened, "second"),
              sign: "-",
            },
          },
          {
            label: `${arrow} remove minus`,
            source: closed,
            operation: {
              kind: "setMessageActivation",
              target: m(closed, "second"),
              sign: null,
            },
          },
          {
            label: `${arrow} remove the plus of a closed pair (refused)`,
            source: closed,
            operation: {
              kind: "setMessageActivation",
              target: m(closed, "first"),
              sign: null,
            },
          },
        ];
        for (const testCase of cases) {
          const plan = planSequenceOperation(
            testCase.source,
            testCase.operation,
          );
          if (!plan.ok) continue;
          planned += 1;
          const problem = await checkPlanAgainstMermaid(
            testCase.label,
            testCase.source,
            testCase.operation,
          );
          if (problem !== null) problems.push(problem);
        }
      }
      expect(problems).toEqual([]);
      // Removing the + of a closed pair is refused (the - would lose its +): 3 of 4 each.
      expect(planned).toBe(SEQUENCE_ARROWS.length * 3);
    },
    TEST_TIMEOUT_MS,
  );
});

// ---- the Tier 2 scenarios of the earlier research

type Outcome =
  | { readonly kind: "plan"; readonly operation: SequenceOperation }
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
const NOT_EDITABLE = "diagramNotEditable";
const ANY: SequenceOperation = { kind: "setTitle", title: "x" };

// What the editor does with each Tier 2 scenario. `swapDirection` and `deleteBlock` are not
// delivered (the editor has no such operation); box edits, create / destroy and links are
// read-only diagrams.
const INTENTS: Readonly<Record<string, (source: string) => Outcome>> = {
  "SQE-P12": () => plan({ kind: "deleteParticipant", participantId: "B" }),
  "SQE-P13": () =>
    refuse("noteSpansParticipants", {
      kind: "deleteParticipant",
      participantId: "B",
    }),
  "SQE-P14": () => refuse(NOT_EDITABLE, ANY),
  "SQE-P15": () => refuse(NOT_EDITABLE, ANY),
  "SQE-P16": () => plan({ kind: "deleteParticipant", participantId: "B" }),
  "SQE-P17": () =>
    plan({
      kind: "reorderParticipants",
      participantId: "B",
      direction: "left",
    }),
  "SQE-P18": () =>
    plan({
      kind: "reorderParticipants",
      participantId: "D",
      direction: "left",
    }),
  "SQE-M29": (source) =>
    plan({ kind: "duplicateMessage", target: m(source, "Hello") }),
  "SQE-B04": (source) =>
    plan({
      kind: "wrapInBlock",
      from: m(source, "Hi"),
      to: m(source, "Bye"),
      block: "loop",
      text: "again",
    }),
  "SQE-B05": (source) =>
    refuse("rangeCrossesBlock", {
      kind: "wrapInBlock",
      from: m(source, "req"),
      to: m(source, "200"),
      block: "loop",
      text: "x",
    }),
  "SQE-B06": () => refuse(NOT_EDITABLE, ANY),
  "SQE-B07": (source) =>
    plan({ kind: "unwrapBlock", target: b(source, "retry") }),
  "SQE-B08": (source) =>
    refuse("hasBranches", { kind: "unwrapBlock", target: b(source, "ok") }),
  "SQE-B10": (source) =>
    plan({ kind: "addBranch", target: b(source, "ok"), text: "other" }),
  "SQE-B11": (source) =>
    plan({ kind: "deleteBranch", target: b(source, "fail") }),
  "SQE-B12": () => refuse(NOT_EDITABLE, ANY),
};

describe("sequence Tier 2 operations: research scenarios against mermaid 12.1.0", () => {
  it(
    "plans or refuses every Tier 2 scenario as intended, and the naive edit was wrong",
    async () => {
      const scenarios = loadSequenceScenarios();
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
          if (scenario.naiveGate !== "PASS") {
            const naive = await mermaidSays(scenario.naiveCandidate);
            if (
              naive === null ||
              firstDifference(comparableOf(result.value.expected), naive) !==
                null
            ) {
              naiveWrong += 1;
            } else {
              problems.push(`${scenario.id}: the naive edit is now correct`);
            }
          }
        } else {
          if (result.ok) {
            problems.push(
              `${scenario.id}: planned, expected ${outcome.reason}`,
            );
            continue;
          }
          refused += 1;
          const reason =
            result.error.kind === NOT_EDITABLE
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
        planned: 9,
        refused: 7,
        naiveWrong: 5,
      });
    },
    TEST_TIMEOUT_MS,
  );
});

// ---- seeded random operation sequences (Tier 1 and Tier 2 mixed)

const BASE_DIAGRAMS: readonly string[] = [SR1, SR2, SR3, SR4, SR5, SR6, SR7];
const TEXTS = ["hello", "a: b", "x\ny", "a; b", "#59; literal", "", "日本語"];
const WRAP_BLOCKS = ["loop", "opt", "alt", "par", "critical", "break"] as const;

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
  const RANGE = ["message", "note", "blockStart"] as const;
  switch (Math.floor(random() * 22)) {
    case 0:
    case 1:
      return { kind: "deleteParticipant", participantId: pick([...ids, "Q"]) };
    case 2:
    case 3:
    case 4:
      return {
        kind: "reorderParticipants",
        participantId: pick(ids),
        direction: pick(["left", "right"] as const),
      };
    case 5:
    case 6:
    case 7: {
      const from = entry(RANGE) ?? stale;
      // Mostly the same entry or a later one, so the range is often valid.
      const to = random() < 0.5 ? from : (entry(RANGE) ?? stale);
      return {
        kind: "wrapInBlock",
        from,
        to,
        block: pick(WRAP_BLOCKS),
        text: pick(TEXTS),
      };
    }
    case 8:
    case 9:
      return { kind: "unwrapBlock", target: entry(["blockStart"]) ?? stale };
    case 10:
    case 11:
      return {
        kind: "addBranch",
        target: entry(["blockStart"]) ?? stale,
        text: pick(TEXTS),
        ...(random() < 0.5
          ? { after: entry(["message", "note", "blockEnd"]) ?? stale }
          : {}),
      };
    case 12:
    case 13:
      return { kind: "deleteBranch", target: entry(["branch"]) ?? stale };
    case 14:
    case 15:
    case 16:
      return {
        kind: "setMessageActivation",
        target: entry(["message"]) ?? stale,
        sign: pick(["+", "-", null] as const),
      };
    case 17:
    case 18:
      return { kind: "duplicateMessage", target: entry(["message"]) ?? stale };
    case 19:
      return { kind: "deleteMessage", target: entry(["message"]) ?? stale };
    case 20:
      return {
        kind: "addMessage",
        from: pick(ids),
        to: pick(ids),
        arrow: pick(SEQUENCE_ARROWS),
        text: pick(TEXTS),
        ...(random() < 0.5
          ? { after: entry(["message", "note"]) ?? stale }
          : {}),
      };
    default:
      return {
        kind: "moveMessage",
        target: entry(["message"]) ?? stale,
        direction: pick(["up", "down"] as const),
      };
  }
}

describe("sequence Tier 2 operations: seeded random sequences against mermaid 12.1.0", () => {
  const SEEDS_PER_DIAGRAM = 14;
  const STEPS_PER_SEQUENCE = 14;

  it(
    "every plan is accepted, read and drawn by Mermaid as promised and undoable",
    async () => {
      const problems: string[] = [];
      let planned = 0;
      let refused = 0;
      const plannedKinds = new Map<string, number>();
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
            plannedKinds.set(
              operation.kind,
              (plannedKinds.get(operation.kind) ?? 0) + 1,
            );
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
      expect({ planned, refused }).toEqual({ planned: 695, refused: 677 });
      // Every Tier 2 operation is planned (and then checked by Mermaid) many times; a change
      // in these numbers means a rule moved.
      expect(Object.fromEntries([...plannedKinds].sort())).toEqual({
        addBranch: 22,
        addMessage: 51,
        deleteBranch: 45,
        deleteMessage: 31,
        deleteParticipant: 70,
        duplicateMessage: 107,
        moveMessage: 12,
        reorderParticipants: 102,
        setMessageActivation: 97,
        unwrapBlock: 53,
        wrapInBlock: 105,
      });
      expect(Object.fromEntries([...reasons].sort())).toEqual({
        activationPairing: 39,
        activationSign: 13,
        atBoundary: 93,
        blockBoundary: 24,
        hasBranches: 8,
        lineBreak: 29,
        noBranches: 37,
        notInBlock: 10,
        noteSpansParticipants: 6,
        participantCreatedLater: 3,
        participantNotFound: 53,
        rangeCrossesBlock: 16,
        rangeOrder: 24,
        sharedLine: 5,
        statementsShareLine: 12,
        targetMismatch: 260,
        targetNotFound: 44,
        unsupportedInRange: 1,
      });
    },
    TEST_TIMEOUT_MS,
  );
});
