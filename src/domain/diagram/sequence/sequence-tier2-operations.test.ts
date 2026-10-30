import { describe, expect, it } from "vitest";
import { applyTextEdits, type TextEdit } from "../text-edit";
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

// Tier 2 operations (docs/architecture.md §16.16.9): exact results, every refusal, the inverse
// edits and the bytes that must stay as they were.

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
const SR4 = `sequenceDiagram
    A->>B: one
    C->>D: two; A->>D: three
    Note right of C: n # c
`;

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
const message = (text: string) => (item: SequenceItemMeaning) =>
  item.kind === "message" && item.text === text;
const header = (text: string) => (item: SequenceItemMeaning) =>
  (item.kind === "blockStart" || item.kind === "branch") && item.text === text;
const m = (source: string, text: string) => target(source, message(text));
const h = (source: string, text: string) => target(source, header(text));

function invert(source: string, edits: readonly TextEdit[]): TextEdit[] {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let delta = 0;
  return sorted.map((edit) => {
    const start = edit.start + delta;
    delta += edit.text.length - (edit.end - edit.start);
    return {
      start,
      end: start + edit.text.length,
      text: source.slice(edit.start, edit.end),
    };
  });
}

// Plans, applies, proves and un-does one operation; returns the new text.
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
  const undone = applyTextEdits(
    applied.value.text,
    invert(source, plan.value.edits),
  );
  expect(undone.ok && undone.value.text).toBe(source);
  return applied.value.text;
}
function refusal(source: string, operation: SequenceOperation): string {
  const plan = planSequenceOperation(source, operation);
  if (plan.ok) throw new Error("expected a refusal");
  return plan.error.kind === "diagramNotEditable"
    ? plan.error.kind
    : (plan.error.detail.split(":")[0] ?? "");
}
const columns = (source: string): string[] =>
  readSequence(source).meaning?.participants.map((p) => p.id) ?? [];

describe("deleteParticipant", () => {
  it("removes the declaration and every message of a declared participant", () => {
    expect(run(SR1, { kind: "deleteParticipant", participantId: "B" })).toBe(
      "sequenceDiagram\n    participant A as Alice\n",
    );
  });

  it("keeps the others where they were and declares an implicit one that the removed line created", () => {
    const result = run(SR2.replace("    Note over A,B: done\n", ""), {
      kind: "deleteParticipant",
      participantId: "C",
    });
    expect(result).toBe("sequenceDiagram\n    A->>+B: call\n    B-->>-A: r2\n");
    expect(columns(result)).toEqual(["A", "B"]);
  });

  it("replaces the first mention of another participant with its declaration", () => {
    const source =
      "sequenceDiagram\n    A->>X: hi\n    B->>A: yo\n    C->>B: z\n";
    const result = run(source, {
      kind: "deleteParticipant",
      participantId: "X",
    });
    expect(result).toBe(
      "sequenceDiagram\n    participant A\n    B->>A: yo\n    C->>B: z\n",
    );
    expect(columns(result)).toEqual(["A", "B", "C"]);
  });

  it("removes activate, deactivate and notes about the participant", () => {
    const source = `sequenceDiagram
    participant A
    participant B
    A->>B: x
    activate B
    Note left of B: n
    deactivate B
    Note over A: keep
`;
    expect(run(source, { kind: "deleteParticipant", participantId: "B" })).toBe(
      "sequenceDiagram\n    participant A\n    Note over A: keep\n",
    );
  });

  it("removes a statement that shares a line with a kept one", () => {
    expect(run(SR4, { kind: "deleteParticipant", participantId: "A" })).toBe(
      "sequenceDiagram\n    participant B\n    C->>D: two\n    Note right of C: n # c\n",
    );
  });

  it("leaves a block empty instead of removing it", () => {
    expect(run(SR3, { kind: "deleteParticipant", participantId: "S" })).toBe(
      "sequenceDiagram\n    participant U as User\n    alt ok\n    else fail\n    end\n    loop retry\n    end\n",
    );
  });

  it("refuses a note that also names another participant", () => {
    expect(
      refusal(SR2, { kind: "deleteParticipant", participantId: "A" }),
    ).toBe("noteSpansParticipants");
  });

  it("refuses to separate an activation from the message that ends it", () => {
    const source =
      "sequenceDiagram\n    X->>+B: call\n    A->>B: log\n    B-->>-A: ret\n";
    expect(
      refusal(source, { kind: "deleteParticipant", participantId: "X" }),
    ).toBe("activationPairing");
    // Both ends belong to B, so B can go.
    expect(run(source, { kind: "deleteParticipant", participantId: "B" })).toBe(
      "sequenceDiagram\n    participant X\n    participant A\n",
    );
  });

  it("refuses when several statements to remove share a line", () => {
    const source = "sequenceDiagram\n    A->>B: x; B->>A: y\n    A->>C: z\n";
    expect(
      refusal(source, { kind: "deleteParticipant", participantId: "B" }),
    ).toBe("sharedLine");
  });

  it("refuses an unknown participant", () => {
    expect(
      refusal(SR1, { kind: "deleteParticipant", participantId: "Q" }),
    ).toBe("participantNotFound");
  });

  it("does not touch a diagram with create / destroy, a box or links (read-only)", () => {
    for (const source of [
      "sequenceDiagram\n    participant A\n    create participant B\n    A->>B: new\n",
      "sequenceDiagram\n    box Team\n        participant A\n    end\n    A->>A: x\n",
      "sequenceDiagram\n    participant A\n    links A: {}\n    A->>A: x\n",
    ]) {
      expect(
        refusal(source, { kind: "deleteParticipant", participantId: "A" }),
      ).toBe("diagramNotEditable");
    }
  });
});

describe("reorderParticipants", () => {
  it("swaps two declarations by moving the right one in front of the left one", () => {
    const result = run(SR1, {
      kind: "reorderParticipants",
      participantId: "B",
      direction: "left",
    });
    expect(result).toBe(
      SR1.replace(
        "    participant A as Alice\n    participant B as Bob\n",
        "    participant B as Bob\n    participant A as Alice\n",
      ),
    );
    expect(columns(result)).toEqual(["B", "A"]);
  });

  it("moves right as the same swap", () => {
    expect(
      run(SR1, {
        kind: "reorderParticipants",
        participantId: "A",
        direction: "right",
      }),
    ).toBe(
      run(SR1, {
        kind: "reorderParticipants",
        participantId: "B",
        direction: "left",
      }),
    );
  });

  it("declares implicit participants in front of their first mention, keeping the ones before", () => {
    const result = run(SR2, {
      kind: "reorderParticipants",
      participantId: "C",
      direction: "left",
    });
    expect(result).toBe(
      "sequenceDiagram\n    participant A\n    participant C\n" +
        SR2.slice("sequenceDiagram\n".length),
    );
    expect(columns(result)).toEqual(["A", "C", "B"]);
  });

  it("works when the participant is mentioned together with the one it passes", () => {
    const result = run("sequenceDiagram\n    A->>B: x\n", {
      kind: "reorderParticipants",
      participantId: "B",
      direction: "left",
    });
    expect(columns(result)).toEqual(["B", "A"]);
  });

  it("moves inline declarations that share a line", () => {
    const source =
      "sequenceDiagram\n    participant A; participant B\n    A->>B: x\n";
    const result = run(source, {
      kind: "reorderParticipants",
      participantId: "B",
      direction: "left",
    });
    expect(result).toBe(
      "sequenceDiagram\n    participant B; participant A\n    A->>B: x\n",
    );
  });

  it("refuses at both ends and for an unknown participant", () => {
    expect(
      refusal(SR1, {
        kind: "reorderParticipants",
        participantId: "A",
        direction: "left",
      }),
    ).toBe("atBoundary");
    expect(
      refusal(SR1, {
        kind: "reorderParticipants",
        participantId: "B",
        direction: "right",
      }),
    ).toBe("atBoundary");
    expect(
      refusal(SR1, {
        kind: "reorderParticipants",
        participantId: "Q",
        direction: "left",
      }),
    ).toBe("participantNotFound");
  });
});

describe("wrapInBlock", () => {
  it("wraps sibling entries and indents them one level", () => {
    expect(
      run(SR1, {
        kind: "wrapInBlock",
        from: m(SR1, "Hi"),
        to: m(SR1, "Bye"),
        block: "loop",
        text: "again",
      }),
    ).toBe(
      "sequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: Hello\n    loop again\n        B-->>A: Hi\n        A->>B: Bye\n    end\n",
    );
  });

  it("takes a whole block when the range ends at its header", () => {
    expect(
      run(SR3, {
        kind: "wrapInBlock",
        from: m(SR3, "req"),
        to: h(SR3, "ok"),
        block: "opt",
        text: "",
      }),
    ).toBe(
      "sequenceDiagram\n    participant U as User\n    participant S as Server\n    opt\n        U->>S: req\n        alt ok\n            S-->>U: 200\n        else fail\n            S-->>U: 500\n        end\n    end\n    loop retry\n        U->>S: again\n    end\n",
    );
  });

  it("uses tabs when the file does and keeps CRLF lines as they are", () => {
    const source =
      "sequenceDiagram\r\n\tparticipant A\r\n\tA->>A: x\r\n\tA->>A: y\r\n";
    expect(
      run(source, {
        kind: "wrapInBlock",
        from: m(source, "x"),
        to: m(source, "y"),
        block: "critical",
        text: "c",
      }),
    ).toBe(
      "sequenceDiagram\r\n\tparticipant A\r\n\tcritical c\r\n\t\tA->>A: x\r\n\t\tA->>A: y\r\n\tend\r\n",
    );
  });

  it("encodes the text and leaves comment lines inside the range alone", () => {
    const source = "sequenceDiagram\n  A->>B: 1\n  % note\n  A->>B: 2\n";
    expect(
      run(source, {
        kind: "wrapInBlock",
        from: m(source, "1"),
        to: m(source, "2"),
        block: "break",
        text: "a; b",
      }),
    ).toBe(
      "sequenceDiagram\n  break a#59; b\n    A->>B: 1\n  % note\n    A->>B: 2\n  end\n",
    );
  });

  it("refuses a range that cuts a block or a branch", () => {
    expect(
      refusal(SR3, {
        kind: "wrapInBlock",
        from: m(SR3, "200"),
        to: m(SR3, "500"),
        block: "loop",
        text: "",
      }),
    ).toBe("rangeCrossesBlock");
    expect(
      refusal(SR3, {
        kind: "wrapInBlock",
        from: m(SR3, "req"),
        to: m(SR3, "200"),
        block: "loop",
        text: "",
      }),
    ).toBe("rangeCrossesBlock");
  });

  it("refuses a range that ends before it starts and unknown blocks", () => {
    expect(
      refusal(SR1, {
        kind: "wrapInBlock",
        from: m(SR1, "Bye"),
        to: m(SR1, "Hello"),
        block: "loop",
        text: "",
      }),
    ).toBe("rangeOrder");
    expect(
      refusal(SR1, {
        kind: "wrapInBlock",
        from: m(SR1, "Hello"),
        to: m(SR1, "Hi"),
        block: "rect" as "loop",
        text: "",
      }),
    ).toBe("invalidBlock");
  });

  it("refuses a range that holds a participant, a title or an autonumber line", () => {
    const source = "sequenceDiagram\n  A->>B: 1\n  participant C\n  A->>B: 2\n";
    expect(
      refusal(source, {
        kind: "wrapInBlock",
        from: m(source, "1"),
        to: m(source, "2"),
        block: "loop",
        text: "",
      }),
    ).toBe("unsupportedInRange");
  });

  it("refuses a range that shares a line, and bad text", () => {
    expect(
      refusal(SR4, {
        kind: "wrapInBlock",
        from: m(SR4, "three"),
        to: m(SR4, "three"),
        block: "loop",
        text: "",
      }),
    ).toBe("sharedLine");
    expect(
      refusal(SR1, {
        kind: "wrapInBlock",
        from: m(SR1, "Hello"),
        to: m(SR1, "Hello"),
        block: "loop",
        text: "%%{init}%%",
      }),
    ).toBe("directive");
  });

  it("refuses a stale target", () => {
    expect(
      refusal(SR1, {
        kind: "wrapInBlock",
        from: { index: 0, fingerprint: "stale" },
        to: m(SR1, "Hi"),
        block: "loop",
        text: "",
      }),
    ).toBe("targetMismatch");
  });
});

describe("unwrapBlock", () => {
  it("removes the header and the end and moves the inner lines back one level", () => {
    expect(run(SR3, { kind: "unwrapBlock", target: h(SR3, "retry") })).toBe(
      SR3.replace(
        "    loop retry\n        U->>S: again\n    end\n",
        "    U->>S: again\n",
      ),
    );
  });

  it("is the inverse of wrapInBlock", () => {
    const wrapped = run(SR1, {
      kind: "wrapInBlock",
      from: m(SR1, "Hi"),
      to: m(SR1, "Bye"),
      block: "loop",
      text: "again",
    });
    expect(
      run(wrapped, { kind: "unwrapBlock", target: h(wrapped, "again") }),
    ).toBe(SR1);
  });

  it("refuses a block with branches until they are deleted", () => {
    expect(refusal(SR3, { kind: "unwrapBlock", target: h(SR3, "ok") })).toBe(
      "hasBranches",
    );
    const without = run(SR3, { kind: "deleteBranch", target: h(SR3, "fail") });
    expect(
      run(without, { kind: "unwrapBlock", target: h(without, "ok") }),
    ).toContain("    U->>S: req\n    S-->>U: 200\n");
  });

  it("refuses a header or end that shares its line, and a target that is not a block", () => {
    const source = "sequenceDiagram\n  loop x # why\n    A->>B: 1\n  end\n";
    expect(
      refusal(source, { kind: "unwrapBlock", target: h(source, "x") }),
    ).toBe("sharedLine");
    expect(refusal(SR1, { kind: "unwrapBlock", target: m(SR1, "Hi") })).toBe(
      "wrongTargetKind",
    );
  });
});

describe("addBranch / deleteBranch", () => {
  it("adds a branch with its text at the end of the block", () => {
    expect(
      run(SR3, { kind: "addBranch", target: h(SR3, "ok"), text: "third" }),
    ).toBe(
      SR3.replace(
        "        S-->>U: 500\n    end\n",
        "        S-->>U: 500\n    else third\n    end\n",
      ),
    );
  });

  it("adds a branch behind an entry of the block, which moves the rest into it", () => {
    expect(
      run(SR3, {
        kind: "addBranch",
        target: h(SR3, "ok"),
        text: "",
        after: m(SR3, "200"),
      }),
    ).toBe(
      SR3.replace("        S-->>U: 200\n", "        S-->>U: 200\n    else\n"),
    );
  });

  it("uses and for par and option for critical", () => {
    const source =
      "sequenceDiagram\n  A->>B: 0\n  par p\n    A->>B: 1\n  end\n  critical c\n    A->>B: 2\n  end\n";
    expect(
      run(source, { kind: "addBranch", target: h(source, "p"), text: "q" }),
    ).toContain("  and q\n  end\n");
    expect(
      run(source, { kind: "addBranch", target: h(source, "c"), text: "o" }),
    ).toContain("  option o\n  end\n");
  });

  it("refuses blocks without branches, entries outside the block and shared lines", () => {
    expect(
      refusal(SR3, { kind: "addBranch", target: h(SR3, "retry"), text: "" }),
    ).toBe("noBranches");
    expect(
      refusal(SR3, {
        kind: "addBranch",
        target: h(SR3, "ok"),
        text: "",
        after: m(SR3, "req"),
      }),
    ).toBe("notInBlock");
    const shared = "sequenceDiagram\n  alt a\n    A->>B: 1; end\n  A->>B: 2\n";
    expect(
      refusal(shared, { kind: "addBranch", target: h(shared, "a"), text: "" }),
    ).toBe("sharedLine");
  });

  it("deletes a branch with its statements", () => {
    expect(run(SR3, { kind: "deleteBranch", target: h(SR3, "fail") })).toBe(
      SR3.replace("    else fail\n        S-->>U: 500\n", ""),
    );
  });

  it("deletes a branch that holds a nested block and declares the participants it created", () => {
    const source =
      "sequenceDiagram\n  participant A\n  alt a\n    A->>A: 1\n  else b\n    loop l\n      A->>X: 2\n    end\n  end\n  X->>A: 3\n";
    const result = run(source, {
      kind: "deleteBranch",
      target: h(source, "b"),
    });
    expect(result).toBe(
      "sequenceDiagram\n  participant A\n  alt a\n    A->>A: 1\n      participant X\n  end\n  X->>A: 3\n",
    );
    expect(columns(result)).toEqual(["A", "X"]);
  });

  it("refuses a branch that holds one end of an activation", () => {
    const source =
      "sequenceDiagram\n  alt a\n    A->>B: 1\n  else b\n    A->>+B: 2\n  end\n  B-->>-A: 3\n";
    expect(
      refusal(source, { kind: "deleteBranch", target: h(source, "b") }),
    ).toBe("activationPairing");
  });

  it("refuses an entry that is not a branch", () => {
    expect(refusal(SR3, { kind: "deleteBranch", target: h(SR3, "ok") })).toBe(
      "wrongTargetKind",
    );
  });
});

describe("setMessageActivation", () => {
  it("writes + after the arrow and removes it again", () => {
    const plus = run(SR1, {
      kind: "setMessageActivation",
      target: m(SR1, "Hello"),
      sign: "+",
    });
    expect(plus).toBe(SR1.replace("A->>B: Hello", "A->>+B: Hello"));
    expect(
      run(plus, {
        kind: "setMessageActivation",
        target: m(plus, "Hello"),
        sign: null,
      }),
    ).toBe(SR1);
  });

  it("closes the activation with - on a reply", () => {
    const plus = run(SR1, {
      kind: "setMessageActivation",
      target: m(SR1, "Hello"),
      sign: "+",
    });
    expect(
      run(plus, {
        kind: "setMessageActivation",
        target: m(plus, "Hi"),
        sign: "-",
      }),
    ).toBe(plus.replace("B-->>A: Hi", "B-->>-A: Hi"));
  });

  it("changes a sign in place and keeps spaces", () => {
    const source = "sequenceDiagram\n  A->>+B: x\n  B-->> -A: y\n";
    expect(
      run(source, {
        kind: "setMessageActivation",
        target: m(source, "y"),
        sign: "+",
      }),
    ).toBe("sequenceDiagram\n  A->>+B: x\n  B-->> +A: y\n");
  });

  it("refuses a - with nothing to end", () => {
    expect(
      refusal(SR1, {
        kind: "setMessageActivation",
        target: m(SR1, "Hi"),
        sign: "-",
      }),
    ).toBe("activationPairing");
  });

  it("refuses to remove the + of a pair, but allows removing the - first", () => {
    expect(
      refusal(SR2, {
        kind: "setMessageActivation",
        target: m(SR2, "inner"),
        sign: null,
      }),
    ).toBe("activationPairing");
    const open = run(SR2, {
      kind: "setMessageActivation",
      target: m(SR2, "r1"),
      sign: null,
    });
    // r1 closed C's activation; now the + of `inner` is unpaired and may go.
    expect(
      run(open, {
        kind: "setMessageActivation",
        target: m(open, "inner"),
        sign: null,
      }),
    ).toBe(
      SR2.replace("B->>+C: inner", "B->>C: inner").replace("C-->>-B", "C-->>B"),
    );
  });

  it("refuses a change that makes another - pair with another +", () => {
    // Taking the inner - away makes the outer - close the inner activation of B.
    const source =
      "sequenceDiagram\n  A->>+B: o\n  A->>+B: i\n  B-->>-A: c1\n  B-->>-A: c2\n";
    expect(
      refusal(source, {
        kind: "setMessageActivation",
        target: m(source, "c1"),
        sign: null,
      }),
    ).toBe("activationPairing");
  });

  it("does nothing when the sign is already as asked, and refuses a non-message", () => {
    const plan = planSequenceOperation(SR2, {
      kind: "setMessageActivation",
      target: m(SR2, "call"),
      sign: "+",
    });
    expect(plan.ok && plan.value.edits).toEqual([]);
    expect(
      refusal(SR3, {
        kind: "setMessageActivation",
        target: h(SR3, "ok"),
        sign: "+",
      }),
    ).toBe("wrongTargetKind");
  });
});

describe("duplicateMessage", () => {
  it("writes a copy right behind the message at the same indentation", () => {
    expect(run(SR3, { kind: "duplicateMessage", target: m(SR3, "500") })).toBe(
      SR3.replace(
        "        S-->>U: 500\n",
        "        S-->>U: 500\n        S-->>U: 500\n",
      ),
    );
  });

  it("copies without + and -", () => {
    expect(run(SR2, { kind: "duplicateMessage", target: m(SR2, "call") })).toBe(
      SR2.replace("    A->>+B: call\n", "    A->>+B: call\n    A->>B: call\n"),
    );
    expect(run(SR2, { kind: "duplicateMessage", target: m(SR2, "r2") })).toBe(
      SR2.replace("    B-->>-A: r2\n", "    B-->>-A: r2\n    B-->>A: r2\n"),
    );
  });

  it("copies a message without text and one without a final line break", () => {
    const source = "sequenceDiagram\n  A->>B:";
    expect(
      run(source, { kind: "duplicateMessage", target: m(source, "") }),
    ).toBe("sequenceDiagram\n  A->>B:\n  A->>B:");
  });

  it("refuses a message that is followed on its line", () => {
    expect(
      refusal(SR4, { kind: "duplicateMessage", target: m(SR4, "two") }),
    ).toBe("sharedLine");
  });
});
