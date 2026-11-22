import { describe, expect, it } from "vitest";
import type { SequenceItemMeaning } from "./sequence-meaning";
import {
  prepareSequence,
  type SequenceItemTarget,
  targetOfItem,
} from "./sequence-operation-support";
import {
  planSequenceOperation,
  type SequenceOperation,
} from "./sequence-operations";

const SOURCE = `sequenceDiagram
    title Plan
    participant A as Alice
    actor B
    A->>B: Hello
    Note over A,B: shared
    loop retry
        B-->>A: again
    end
`;

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

const MESSAGE = targetOf(SOURCE, (item) => item.kind === "message");
const NOTE = targetOf(SOURCE, (item) => item.kind === "note");
const STALE: SequenceItemTarget = { index: 0, fingerprint: "stale" };

function refusal(operation: SequenceOperation, source = SOURCE): string {
  const plan = planSequenceOperation(source, operation);
  return plan.ok ? "" : plan.error.detail;
}

function editsOf(operation: SequenceOperation, source = SOURCE) {
  const plan = planSequenceOperation(source, operation);
  if (!plan.ok) throw new Error(plan.error.detail);
  return plan.value.edits;
}

describe("refusals of every kind", () => {
  it.each<[string, SequenceOperation, string]>([
    [
      "a participant kind it does not know",
      { kind: "addParticipant", participantKind: "robot" as never, label: "R" },
      "invalidKind",
    ],
    [
      "changing to a kind it does not know",
      {
        kind: "changeParticipantKind",
        participantId: "A",
        participantKind: "robot" as never,
      },
      "invalidKind",
    ],
    [
      "a placement it does not know",
      {
        kind: "addNote",
        placement: "middle" as never,
        participants: ["A"],
        text: "x",
      },
      "",
    ],
    [
      "moving a note to a placement it does not know",
      {
        kind: "changeNotePlacement",
        target: NOTE,
        placement: "middle" as never,
      },
      "invalidPlacement",
    ],
    [
      "an arrow it does not know",
      { kind: "changeArrow", target: MESSAGE, arrow: "~>" as never },
      "invalidArrow",
    ],
    [
      "a stale message",
      { kind: "editMessageText", target: STALE, text: "x" },
      "",
    ],
    [
      "changing the arrow of a stale entry",
      { kind: "changeArrow", target: STALE, arrow: "->>" },
      "",
    ],
    [
      "the arrow of a note",
      { kind: "changeArrow", target: NOTE, arrow: "->>" },
      "wrongTargetKind",
    ],
    [
      "the placement of a message",
      { kind: "changeNotePlacement", target: MESSAGE, placement: "over" },
      "wrongTargetKind",
    ],
    ["deleting a stale message", { kind: "deleteMessage", target: STALE }, ""],
    ["deleting a stale note", { kind: "deleteNote", target: STALE }, ""],
    [
      "the text of a stale block",
      { kind: "editBlockText", target: STALE, text: "x" },
      "",
    ],
  ])("refuses %s", (_what, operation, reason) => {
    const detail = refusal(operation);
    expect(detail).not.toBe("");
    expect(detail).toContain(reason);
  });
});

describe("operations that change nothing", () => {
  it.each<[string, SequenceOperation]>([
    [
      "the same participant kind",
      {
        kind: "changeParticipantKind",
        participantId: "B",
        participantKind: "actor",
      },
    ],
    [
      "the same message text",
      { kind: "editMessageText", target: MESSAGE, text: "Hello" },
    ],
    ["the same arrow", { kind: "changeArrow", target: MESSAGE, arrow: "->>" }],
    ["the same title", { kind: "setTitle", title: "Plan" }],
  ])("plans no edit for %s", (_what, operation) => {
    expect(editsOf(operation)).toEqual([]);
  });

  it("plans no edit to remove a title that is not there", () => {
    expect(
      editsOf(
        { kind: "setTitle", title: "" },
        "sequenceDiagram\n    A->>B: hi\n",
      ),
    ).toEqual([]);
  });
});

describe("participants", () => {
  it("writes no alias for a label equal to the id", () => {
    const edits = editsOf({
      kind: "addParticipant",
      participantKind: "participant",
      label: "C",
      id: "C",
    });
    expect(edits.map((edit) => edit.text).join("")).not.toContain(" as ");
  });

  it("adds a participant to a diagram that declares none", () => {
    const source = "sequenceDiagram\n    A->>B: hi\n";
    expect(
      editsOf(
        { kind: "addParticipant", participantKind: "actor", label: "Carol" },
        source,
      ).length,
    ).toBe(1);
  });
});
