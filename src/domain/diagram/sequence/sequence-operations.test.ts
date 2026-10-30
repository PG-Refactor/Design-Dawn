import { describe, expect, it } from "vitest";
import { applyTextEdits } from "../text-edit";
import type { SequenceItemMeaning } from "./sequence-meaning";
import {
  prepareSequence,
  type SequenceItemTarget,
  targetOfItem,
} from "./sequence-operation-support";
import {
  planSequenceOperation,
  type SequenceOperation,
  verifySequenceCandidate,
} from "./sequence-operations";
import { readSequence } from "./sequence-reader";

const SR1 = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello
    B-->>A: Hi
    A->>B: Bye
`;
const SR2 = `sequenceDiagram
    A->>+B: call
    B->>+C: inner
    C-->>-B: r1
    B-->>-A: r2
    Note over A,B: done
`;
const SR3 = `sequenceDiagram
    participant U as User
    participant S as Server
    U->>S: req
    alt ok
        S-->>U: 200
    else fail
        S-->>U: 500
    end
    loop retry
        U->>S: again
    end
`;
const SR6 = `sequenceDiagram
    A->>B: one
    C->>D: two
    A->>D: three
`;

// The target of the first entry the predicate accepts.
function target(
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
const messageWith = (text: string) => (item: SequenceItemMeaning) =>
  item.kind === "message" && item.text === text;
const noteWith = (text: string) => (item: SequenceItemMeaning) =>
  item.kind === "note" && item.text === text;

// Plans, applies and proves one operation; returns the new text.
function run(source: string, operation: SequenceOperation): string {
  const plan = planSequenceOperation(source, operation);
  if (!plan.ok) throw new Error(`refused: ${plan.error.detail}`);
  const applied = applyTextEdits(source, plan.value.edits);
  if (!applied.ok) throw new Error(applied.error.detail);
  const verified = verifySequenceCandidate(
    applied.value.text,
    plan.value.expected,
  );
  if (!verified.ok) throw new Error(`unverified: ${verified.error.detail}`);
  return applied.value.text;
}
function refusal(source: string, operation: SequenceOperation): string {
  const plan = planSequenceOperation(source, operation);
  if (plan.ok) throw new Error("expected a refusal");
  return plan.error.detail.split(":")[0] ?? "";
}

describe("addParticipant", () => {
  it("appends the declaration behind the last declaration", () => {
    expect(
      run(SR1, {
        kind: "addParticipant",
        participantKind: "actor",
        label: "Dan",
        id: "D",
      }),
    ).toBe(
      SR1.replace(
        "    A->>B: Hello\n",
        "    actor D as Dan\n    A->>B: Hello\n",
      ),
    );
  });

  it("goes behind the last declaration, ahead of implicit participants", () => {
    const source = "sequenceDiagram\n  participant A\n  A->>C: x\n";
    const result = run(source, {
      kind: "addParticipant",
      participantKind: "participant",
      label: "Dan",
      id: "D",
    });
    expect(result).toBe(
      "sequenceDiagram\n  participant A\n  participant D as Dan\n  A->>C: x\n",
    );
    expect(readSequence(result).meaning?.participants.map((p) => p.id)).toEqual(
      ["A", "D", "C"],
    );
  });

  it("goes in front of the first statement when nothing is declared", () => {
    expect(
      run(SR6, {
        kind: "addParticipant",
        participantKind: "participant",
        label: "",
        id: "Z",
      }),
    ).toBe(SR6.replace("    A->>B: one", "    participant Z\n    A->>B: one"));
  });

  it("makes up an id and writes no alias for an empty label", () => {
    const result = run(SR1, {
      kind: "addParticipant",
      participantKind: "participant",
      label: "",
    });
    expect(result).toContain("    participant B as Bob\n    participant P1\n");
  });

  it("works on a source without a final line break and with CRLF", () => {
    expect(
      run(SR1.trimEnd(), {
        kind: "addParticipant",
        participantKind: "participant",
        label: "Dan",
        id: "D",
      }),
    ).toBe(
      `${SR1.replace("    A->>B: Hello", "    participant D as Dan\n    A->>B: Hello")}`.trimEnd(),
    );
    const crlf = SR1.replace(/\n/g, "\r\n");
    expect(
      run(crlf, {
        kind: "addParticipant",
        participantKind: "participant",
        label: "Dan",
        id: "D",
      }),
    ).toContain("participant B as Bob\r\n    participant D as Dan\r\n");
  });

  it("encodes ; and # in the label and refuses what it cannot write", () => {
    expect(
      run(SR1, {
        kind: "addParticipant",
        participantKind: "participant",
        label: "Ops;Team #1",
        id: "O",
      }),
    ).toContain("participant O as Ops#59;Team #35;1\n");
    for (const label of ["a%%{x}%%", "wrap: x", "a\nb", "a\tb"]) {
      expect(
        refusal(SR1, {
          kind: "addParticipant",
          participantKind: "participant",
          label,
        }),
      ).not.toBe("");
    }
  });

  it("refuses a duplicate, reserved or malformed id", () => {
    const base = {
      kind: "addParticipant",
      participantKind: "participant",
      label: "x",
    } as const;
    expect(refusal(SR1, { ...base, id: "A" })).toBe("duplicateId");
    expect(refusal(SR1, { ...base, id: "End" })).toBe("reservedId");
    expect(refusal(SR1, { ...base, id: "a b" })).toBe("invalidId");
    expect(refusal(SR1, { ...base, id: "ユーザー" })).toBe("invalidId");
  });
});

describe("renameParticipantLabel and changeParticipantKind", () => {
  it("replaces the alias", () => {
    expect(
      run(SR1.replace("Hello", "Hello Alice"), {
        kind: "renameParticipantLabel",
        participantId: "A",
        label: "Alicia",
      }),
    ).toBe(
      SR1.replace("Hello", "Hello Alice").replace("as Alice", "as Alicia"),
    );
  });

  it("adds an alias to a declaration without one", () => {
    const source = "sequenceDiagram\n  participant A\n  A->>B: x\n";
    expect(
      run(source, {
        kind: "renameParticipantLabel",
        participantId: "A",
        label: "Al",
      }),
    ).toBe("sequenceDiagram\n  participant A as Al\n  A->>B: x\n");
  });

  it("declares an implicit participant in front of its first mention", () => {
    expect(
      run(SR2, {
        kind: "renameParticipantLabel",
        participantId: "A",
        label: "Alice",
      }),
    ).toBe(
      SR2.replace(
        "    A->>+B: call",
        "    participant A as Alice\n    A->>+B: call",
      ),
    );
  });

  it("declares everything the first mention creates up to the participant", () => {
    const result = run(SR6, {
      kind: "renameParticipantLabel",
      participantId: "B",
      label: "Bob",
    });
    expect(result).toBe(
      SR6.replace(
        "    A->>B: one",
        "    participant A\n    participant B as Bob\n    A->>B: one",
      ),
    );
    expect(readSequence(result).meaning?.participants.map((p) => p.id)).toEqual(
      ["A", "B", "C", "D"],
    );
  });

  it("declares inline when the first mention shares its line", () => {
    const source = "sequenceDiagram\n  A->>B: x; C->>D: y\n";
    const result = run(source, {
      kind: "renameParticipantLabel",
      participantId: "C",
      label: "Carl",
    });
    expect(result).toBe(
      "sequenceDiagram\n  A->>B: x; participant C as Carl; C->>D: y\n",
    );
  });

  it("changes participant to actor by the keyword only", () => {
    expect(
      run(SR1.replace("Hello", "participant list"), {
        kind: "changeParticipantKind",
        participantId: "A",
        participantKind: "actor",
      }),
    ).toBe(
      SR1.replace("Hello", "participant list").replace(
        "participant A",
        "actor A",
      ),
    );
  });

  it("declares an implicit participant as an actor", () => {
    const result = run(SR2, {
      kind: "changeParticipantKind",
      participantId: "B",
      participantKind: "actor",
    });
    expect(result).toContain(
      "    participant A\n    actor B\n    A->>+B: call",
    );
  });

  it("does nothing for the same value and refuses what it cannot do", () => {
    expect(
      planSequenceOperation(SR1, {
        kind: "renameParticipantLabel",
        participantId: "A",
        label: "Alice",
      }),
    ).toMatchObject({ ok: true, value: { edits: [] } });
    expect(
      refusal(SR1, {
        kind: "renameParticipantLabel",
        participantId: "Z",
        label: "x",
      }),
    ).toBe("participantNotFound");
    expect(
      refusal(SR1, {
        kind: "renameParticipantLabel",
        participantId: "A",
        label: " ",
      }),
    ).toBe("emptyLabel");
    expect(
      refusal("sequenceDiagram\n participant A as x#quot;y\n", {
        kind: "renameParticipantLabel",
        participantId: "A",
        label: "z",
      }),
    ).toBe("entityLikeText");
  });
});

describe("messages", () => {
  it("adds a message at the end", () => {
    expect(
      run(SR1, {
        kind: "addMessage",
        from: "B",
        to: "A",
        arrow: "-->>",
        text: "Later",
      }),
    ).toBe(`${SR1}    B-->>A: Later\n`);
  });

  it("adds a message without a final line break and with CRLF", () => {
    expect(
      run(SR1.trimEnd(), {
        kind: "addMessage",
        from: "B",
        to: "A",
        arrow: "-->>",
        text: "x",
      }),
    ).toBe(`${SR1}    B-->>A: x`);
    expect(
      run(SR1.replace(/\n/g, "\r\n"), {
        kind: "addMessage",
        from: "B",
        to: "A",
        arrow: "->",
        text: "x",
      }),
    ).toMatch(/\r\n {4}B->A: x\r\n$/);
  });

  it("uses the indentation of the diagram (tabs)", () => {
    expect(
      run(SR1.replace(/^ {4}/gm, "\t"), {
        kind: "addMessage",
        from: "B",
        to: "A",
        arrow: "->>",
        text: "x",
      }),
    ).toMatch(/\tA->>B: Bye\n\tB->>A: x\n$/);
  });

  it("adds a message behind a message inside a block, at its indentation", () => {
    const result = run(SR3, {
      kind: "addMessage",
      from: "U",
      to: "S",
      arrow: "->>",
      text: "ack",
      after: target(SR3, messageWith("200")),
    });
    expect(result).toBe(
      SR3.replace(
        "        S-->>U: 200\n",
        "        S-->>U: 200\n        U->>S: ack\n",
      ),
    );
  });

  it("writes an empty text as a colon only", () => {
    expect(
      run(SR1, {
        kind: "addMessage",
        from: "A",
        to: "B",
        arrow: "->>",
        text: "",
      }),
    ).toBe(`${SR1}    A->>B:\n`);
  });

  it("encodes the text", () => {
    expect(
      run(SR1, {
        kind: "addMessage",
        from: "A",
        to: "B",
        arrow: "->>",
        text: "a; b #5\nline 2",
      }),
    ).toBe(`${SR1}    A->>B: a#59; b #35;5<br/>line 2\n`);
  });

  it("refuses unknown participants, a participant created further down and bad text", () => {
    expect(
      refusal(SR1, {
        kind: "addMessage",
        from: "A",
        to: "Z",
        arrow: "->>",
        text: "x",
      }),
    ).toBe("participantNotFound");
    expect(
      refusal(SR6, {
        kind: "addMessage",
        from: "A",
        to: "D",
        arrow: "->>",
        text: "x",
        after: target(SR6, messageWith("one")),
      }),
    ).toBe("participantCreatedLater");
    for (const text of [
      "wrap: x",
      ":wrap:x",
      "NoWrap: x",
      "a %%{init: {}}%% b",
      "a\tb",
    ]) {
      expect(
        refusal(SR1, {
          kind: "addMessage",
          from: "A",
          to: "B",
          arrow: "->>",
          text,
        }),
      ).not.toBe("");
    }
    expect(
      refusal(SR1, {
        kind: "addMessage",
        from: "A",
        to: "B",
        arrow: "~>" as never,
        text: "x",
      }),
    ).toBe("invalidArrow");
  });

  it("refuses to insert behind a statement that shares its line", () => {
    const source =
      "sequenceDiagram\n  participant A\n  participant B\n  A->>B: one; B->>A: two\n";
    expect(
      refusal(source, {
        kind: "addMessage",
        from: "A",
        to: "B",
        arrow: "->>",
        text: "x",
        after: target(source, messageWith("one")),
      }),
    ).toBe("sharedLine");
  });

  it("edits the text span only", () => {
    expect(
      run(SR2, {
        kind: "editMessageText",
        target: target(SR2, messageWith("call")),
        text: "call2",
      }),
    ).toBe(SR2.replace("call", "call2"));
    const withComment = "sequenceDiagram\n    A->>B: x # tail\n";
    expect(
      run(withComment, {
        kind: "editMessageText",
        target: target(withComment, messageWith("x")),
        text: "y",
      }),
    ).toBe("sequenceDiagram\n    A->>B: y # tail\n");
    const withPercent = "sequenceDiagram\n    A->>B: x %% tail\n";
    expect(
      run(withPercent, {
        kind: "editMessageText",
        target: target(withPercent, messageWith("x %% tail")),
        text: "y",
      }),
    ).toBe("sequenceDiagram\n    A->>B: y\n");
  });

  it("edits text on a line shared by statements and gives an empty text a place", () => {
    const shared = "sequenceDiagram\n    A->>B: one; B->>A: two\n";
    expect(
      run(shared, {
        kind: "editMessageText",
        target: target(shared, messageWith("one")),
        text: "uno",
      }),
    ).toBe("sequenceDiagram\n    A->>B: uno; B->>A: two\n");
    const empty = "sequenceDiagram\n    A->>B:\n";
    expect(
      run(empty, {
        kind: "editMessageText",
        target: target(empty, messageWith("")),
        text: "now",
      }),
    ).toBe("sequenceDiagram\n    A->>B: now\n");
  });

  it("refuses to edit text that holds foreign entities and a stale target", () => {
    const source = "sequenceDiagram\n  A->>B: say #quot;hi#quot;\n";
    expect(
      refusal(source, {
        kind: "editMessageText",
        target: target(source, (item) => item.kind === "message"),
        text: "x",
      }),
    ).toBe("entityLikeText");
    expect(
      refusal(SR1, {
        kind: "editMessageText",
        target: { index: 0, fingerprint: "nope" },
        text: "x",
      }),
    ).toBe("targetMismatch");
    expect(
      refusal(SR1, {
        kind: "editMessageText",
        target: { index: 99, fingerprint: "nope" },
        text: "x",
      }),
    ).toBe("targetNotFound");
  });

  it("changes the arrow and keeps the sign", () => {
    expect(
      run(SR2.replace("call", "call a->>b"), {
        kind: "changeArrow",
        target: target(
          SR2.replace("call", "call a->>b"),
          messageWith("call a->>b"),
        ),
        arrow: "-->>",
      }),
    ).toBe(SR2.replace("call", "call a->>b").replace("A->>+B", "A-->>+B"));
    expect(
      run(SR1, {
        kind: "changeArrow",
        target: target(SR1, messageWith("Hello")),
        arrow: "<<->>",
      }),
    ).toBe(SR1.replace("A->>B: Hello", "A<<->>B: Hello"));
  });

  it("deletes a message line", () => {
    expect(
      run(SR1, {
        kind: "deleteMessage",
        target: target(SR1, messageWith("Hi")),
      }),
    ).toBe(SR1.replace("    B-->>A: Hi\n", ""));
    expect(
      run(SR1.trimEnd(), {
        kind: "deleteMessage",
        target: target(SR1.trimEnd(), messageWith("Bye")),
      }),
    ).toBe(SR1.replace("\n    A->>B: Bye\n", ""));
  });

  it("deletes one statement of a shared line with its separator", () => {
    const shared =
      "sequenceDiagram\n  participant A\n  participant B\n  A->>B: one; B->>A: two\n";
    expect(
      run(shared, {
        kind: "deleteMessage",
        target: target(shared, messageWith("two")),
      }),
    ).toBe("sequenceDiagram\n  participant A\n  participant B\n  A->>B: one\n");
    expect(
      run(shared, {
        kind: "deleteMessage",
        target: target(shared, messageWith("one")),
      }),
    ).toBe("sequenceDiagram\n  participant A\n  participant B\n  B->>A: two\n");
  });

  it("declares the participants a deleted first mention created", () => {
    const result = run(SR6, {
      kind: "deleteMessage",
      target: target(SR6, messageWith("one")),
    });
    expect(result).toBe(
      "sequenceDiagram\n    participant A\n    participant B\n    C->>D: two\n    A->>D: three\n",
    );
  });

  it("declares in line when the deleted message shares its line", () => {
    const shared = "sequenceDiagram\n  A->>B: one; C->>D: two\n";
    expect(
      run(shared, {
        kind: "deleteMessage",
        target: target(shared, messageWith("two")),
      }),
    ).toBe("sequenceDiagram\n  A->>B: one; participant C; participant D\n");
  });

  it("refuses to delete a message with an activation sign", () => {
    expect(
      refusal(SR2, {
        kind: "deleteMessage",
        target: target(SR2, messageWith("call")),
      }),
    ).toBe("activationSign");
    expect(
      refusal(SR2, {
        kind: "deleteMessage",
        target: target(SR2, messageWith("r2")),
      }),
    ).toBe("activationSign");
  });

  it("moves a message down and up", () => {
    const down = run(SR1, {
      kind: "moveMessage",
      target: target(SR1, messageWith("Hi")),
      direction: "down",
    });
    expect(down).toBe(
      "sequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: Hello\n    A->>B: Bye\n    B-->>A: Hi\n",
    );
    expect(
      run(down, {
        kind: "moveMessage",
        target: target(down, messageWith("Hi")),
        direction: "up",
      }),
    ).toBe(SR1);
  });

  it("moves a message past a note", () => {
    const source =
      "sequenceDiagram\n  participant A\n  participant B\n  A->>B: x\n  Note over A: n\n";
    expect(
      run(source, {
        kind: "moveMessage",
        target: target(source, messageWith("x")),
        direction: "down",
      }),
    ).toBe(
      "sequenceDiagram\n  participant A\n  participant B\n  Note over A: n\n  A->>B: x\n",
    );
  });

  it("declares the participants first when a move would reorder the columns", () => {
    const result = run(SR6, {
      kind: "moveMessage",
      target: target(SR6, messageWith("one")),
      direction: "down",
    });
    expect(result).toBe(
      "sequenceDiagram\n    participant A\n    participant B\n    participant C\n    participant D\n    C->>D: two\n    A->>B: one\n    A->>D: three\n",
    );
  });

  it("swaps two statements of one line in place", () => {
    const shared =
      "sequenceDiagram\n  participant A\n  participant B\n  A->>B: one; B->>A: two\n";
    expect(
      run(shared, {
        kind: "moveMessage",
        target: target(shared, messageWith("two")),
        direction: "up",
      }),
    ).toBe(
      "sequenceDiagram\n  participant A\n  participant B\n  B->>A: two; A->>B: one\n",
    );
  });

  it("refuses to move across a block boundary, an activation pair or the ends", () => {
    expect(
      refusal(SR3, {
        kind: "moveMessage",
        target: target(SR3, messageWith("req")),
        direction: "down",
      }),
    ).toBe("blockBoundary");
    expect(
      refusal(SR3, {
        kind: "moveMessage",
        target: target(SR3, messageWith("again")),
        direction: "down",
      }),
    ).toBe("blockBoundary");
    expect(
      refusal(SR2, {
        kind: "moveMessage",
        target: target(SR2, messageWith("inner")),
        direction: "down",
      }),
    ).toBe("activationSign");
    expect(
      refusal(SR1, {
        kind: "moveMessage",
        target: target(SR1, messageWith("Hello")),
        direction: "up",
      }),
    ).toBe("blockBoundary");
    expect(
      refusal(SR1, {
        kind: "moveMessage",
        target: target(SR1, messageWith("Bye")),
        direction: "down",
      }),
    ).toBe("atBoundary");
  });
});

describe("notes", () => {
  it("adds a note at the end and behind a message", () => {
    expect(
      run(SR1, {
        kind: "addNote",
        placement: "over",
        participants: ["A", "B"],
        text: "n",
      }),
    ).toBe(`${SR1}    Note over A,B: n\n`);
    expect(
      run(SR1, {
        kind: "addNote",
        placement: "leftOf",
        participants: ["A"],
        text: "n",
        after: target(SR1, messageWith("Hello")),
      }),
    ).toBe(
      SR1.replace(
        "    A->>B: Hello\n",
        "    A->>B: Hello\n    Note left of A: n\n",
      ),
    );
  });

  it("refuses a note with the wrong participants", () => {
    for (const participants of [[], ["A", "B"], ["Z"]]) {
      expect(
        refusal(SR1, {
          kind: "addNote",
          placement: "rightOf",
          participants,
          text: "x",
        }),
      ).not.toBe("");
    }
    expect(
      refusal(SR1, {
        kind: "addNote",
        placement: "over",
        participants: ["A", "A"],
        text: "x",
      }),
    ).toBe("noteParticipants");
  });

  it("edits the text and changes the placement", () => {
    expect(
      run(SR2, {
        kind: "editNoteText",
        target: target(SR2, noteWith("done")),
        text: "finished",
      }),
    ).toBe(SR2.replace("done", "finished"));
    expect(
      run(SR2, {
        kind: "changeNotePlacement",
        target: target(SR2, noteWith("done")),
        placement: "leftOf",
      }),
    ).toBe(SR2.replace("over A,B", "left of A"));
    const single = "sequenceDiagram\n  participant A\n  Note left of A: n\n";
    expect(
      run(single, {
        kind: "changeNotePlacement",
        target: target(single, noteWith("n")),
        placement: "over",
      }),
    ).toBe("sequenceDiagram\n  participant A\n  Note over A: n\n");
  });

  it("refuses to drop a participant that only the note creates", () => {
    const source = "sequenceDiagram\n  participant A\n  Note over A,Z: n\n";
    expect(
      refusal(source, {
        kind: "changeNotePlacement",
        target: target(source, noteWith("n")),
        placement: "rightOf",
      }),
    ).toBe("dropsParticipant");
  });

  it("deletes a note, declaring a participant only the note mentions", () => {
    const source =
      "sequenceDiagram\n    participant A\n    Note over Z: n\n    A->>A: x\n";
    expect(
      run(source, {
        kind: "deleteNote",
        target: target(source, noteWith("n")),
      }),
    ).toBe(
      "sequenceDiagram\n    participant A\n    participant Z\n    A->>A: x\n",
    );
    expect(
      run(SR2, { kind: "deleteNote", target: target(SR2, noteWith("done")) }),
    ).toBe(SR2.replace("    Note over A,B: done\n", ""));
  });
});

describe("blocks, autonumber and title", () => {
  const blockTarget = (source: string, text: string) =>
    target(
      source,
      (item) =>
        (item.kind === "blockStart" || item.kind === "branch") &&
        item.text === text,
    );

  it("edits block and branch text and gives an empty one a place", () => {
    expect(
      run(SR3, {
        kind: "editBlockText",
        target: blockTarget(SR3, "retry"),
        text: "retry 3x",
      }),
    ).toBe(SR3.replace("retry", "retry 3x"));
    const bare = SR3.replace("else fail", "else");
    expect(
      run(bare, {
        kind: "editBlockText",
        target: blockTarget(bare, ""),
        text: "fail",
      }),
    ).toBe(SR3);
    expect(
      run(SR3, {
        kind: "editBlockText",
        target: blockTarget(SR3, "retry"),
        text: "a;b #1",
      }),
    ).toBe(SR3.replace("retry", "a#59;b #35;1"));
  });

  it("refuses to edit a rect and any text that does not fit a block", () => {
    const rect = "sequenceDiagram\n  rect rgb(1,2,3)\n    A->>B: x\n  end\n";
    expect(
      refusal(rect, {
        kind: "editBlockText",
        target: blockTarget(rect, "rgb(1,2,3)"),
        text: "x",
      }),
    ).toBe("colourBlock");
    expect(
      refusal(SR3, {
        kind: "editBlockText",
        target: blockTarget(SR3, "retry"),
        text: "a\nb",
      }),
    ).toBe("lineBreak");
    expect(
      refusal(SR3, {
        kind: "editBlockText",
        target: blockTarget(SR3, "retry"),
        text: "a %% b",
      }),
    ).toBe("doublePercent");
  });

  it("turns autonumber on and off", () => {
    const on = run(SR1, { kind: "setAutonumber", enabled: true });
    expect(on).toBe(
      SR1.replace("sequenceDiagram\n", "sequenceDiagram\n    autonumber\n"),
    );
    expect(run(on, { kind: "setAutonumber", enabled: false })).toBe(SR1);
    expect(
      planSequenceOperation(on, { kind: "setAutonumber", enabled: true }),
    ).toMatchObject({ ok: true, value: { edits: [] } });
    expect(
      planSequenceOperation(SR1, { kind: "setAutonumber", enabled: false }),
    ).toMatchObject({ ok: true, value: { edits: [] } });
  });

  it("works on a header-only source and refuses an autonumber it cannot toggle", () => {
    expect(
      run("sequenceDiagram", { kind: "setAutonumber", enabled: true }),
    ).toBe("sequenceDiagram\n    autonumber");
    for (const source of [
      "sequenceDiagram\n  autonumber 10\n  A->>B: x\n",
      "sequenceDiagram\n  autonumber\n  A->>B: x\n  autonumber off\n",
    ]) {
      expect(refusal(source, { kind: "setAutonumber", enabled: false })).toBe(
        "autonumberNotBare",
      );
    }
  });

  it("sets, changes and removes the title", () => {
    const titled = run(SR1, { kind: "setTitle", title: "Login; flow" });
    expect(titled).toBe(
      SR1.replace(
        "sequenceDiagram\n",
        "sequenceDiagram\n    title Login#59; flow\n",
      ),
    );
    expect(run(titled, { kind: "setTitle", title: "New" })).toContain(
      "title New\n",
    );
    expect(run(titled, { kind: "setTitle", title: "" })).toBe(SR1);
    const colon = "sequenceDiagram\n  title: Old\n  A->>B: x\n";
    expect(run(colon, { kind: "setTitle", title: "New" })).toBe(
      "sequenceDiagram\n  title: New\n  A->>B: x\n",
    );
    expect(
      refusal("sequenceDiagram\n  title One\n  title Two\n  A->>B: x\n", {
        kind: "setTitle",
        title: "x",
      }),
    ).toBe("multipleTitles");
  });
});

describe("a diagram that is not editable", () => {
  it("is refused by every operation", () => {
    const plan = planSequenceOperation("sequenceDiagram\n  A->>()B: x\n", {
      kind: "setTitle",
      title: "x",
    });
    expect(plan).toMatchObject({
      ok: false,
      error: { kind: "diagramNotEditable" },
    });
  });
});
