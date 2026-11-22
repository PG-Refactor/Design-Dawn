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
} from "./sequence-operations";

function targetOf(
  source: string,
  predicate: (item: SequenceItemMeaning) => boolean,
  nth = 0,
): SequenceItemTarget {
  const prepared = prepareSequence(source);
  if (!prepared.ok) throw new Error(prepared.error.detail);
  const matches = prepared.value.meaning.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => predicate(item));
  const found = matches[nth];
  if (found === undefined) throw new Error("no such entry");
  return targetOfItem(found.index, found.item);
}

const STALE: SequenceItemTarget = { index: 0, fingerprint: "stale" };

function run(source: string, operation: SequenceOperation): string {
  const plan = planSequenceOperation(source, operation);
  if (!plan.ok) throw new Error(`refused: ${plan.error.detail}`);
  const applied = applyTextEdits(source, plan.value.edits);
  if (!applied.ok) throw new Error(applied.error.detail);
  return applied.value.text;
}

function refusal(source: string, operation: SequenceOperation): string {
  const plan = planSequenceOperation(source, operation);
  return plan.ok ? "" : plan.error.detail;
}

const isMessage = (item: SequenceItemMeaning) => item.kind === "message";
const isBlock = (item: SequenceItemMeaning) => item.kind === "blockStart";
const isBranch = (item: SequenceItemMeaning) => item.kind === "branch";

describe("wrapping in a block", () => {
  const NESTED = `sequenceDiagram
    A->>B: one
    loop outer
        A->>B: two
        opt inner
            B->>A: three
        end
    end
`;

  it("wraps a range that ends with a block, nested blocks included", () => {
    const result = run(NESTED, {
      kind: "wrapInBlock",
      from: targetOf(NESTED, isMessage),
      to: targetOf(NESTED, isBlock),
      block: "critical",
      text: "all",
    });
    expect(result).toContain("critical all");
  });

  it("refuses a stale end of the range", () => {
    expect(
      refusal(NESTED, {
        kind: "wrapInBlock",
        from: targetOf(NESTED, isMessage),
        to: STALE,
        block: "loop",
        text: "x",
      }),
    ).not.toBe("");
  });
});

describe("unwrapping", () => {
  it("unwraps an empty block, and one whose lines are not indented", () => {
    expect(
      run("sequenceDiagram\n    A->>B: x\n    loop l\n    end\n", {
        kind: "unwrapBlock",
        target: targetOf(
          "sequenceDiagram\n    A->>B: x\n    loop l\n    end\n",
          isBlock,
        ),
      }),
    ).toBe("sequenceDiagram\n    A->>B: x\n");
    const flat = "sequenceDiagram\nloop l\nA->>B: x\nend\n";
    expect(
      run(flat, { kind: "unwrapBlock", target: targetOf(flat, isBlock) }),
    ).toBe("sequenceDiagram\nA->>B: x\n");
  });

  it("leaves a line that is less indented than the block content alone", () => {
    const source =
      "sequenceDiagram\n    loop l\n        A->>B: x\n      B->>A: y\n    end\n";
    expect(
      run(source, { kind: "unwrapBlock", target: targetOf(source, isBlock) }),
    ).toBe("sequenceDiagram\n    A->>B: x\n      B->>A: y\n");
  });
});

describe("branches", () => {
  const ALT = `sequenceDiagram
    alt ok
        A->>B: one; B->>A: two
    else fail
        participant C
    end
`;

  it("refuses a stale block, a stale entry to follow, and an entry followed by another", () => {
    expect(
      refusal(ALT, { kind: "addBranch", target: STALE, text: "x" }),
    ).not.toBe("");
    expect(
      refusal(ALT, {
        kind: "addBranch",
        target: targetOf(ALT, isBlock),
        text: "x",
        after: STALE,
      }),
    ).not.toBe("");
    expect(
      refusal(ALT, {
        kind: "addBranch",
        target: targetOf(ALT, isBlock),
        text: "x",
        after: targetOf(ALT, isMessage),
      }),
    ).toContain("sharedLine");
  });

  it("refuses a branch text it cannot write", () => {
    expect(
      refusal(ALT, {
        kind: "addBranch",
        target: targetOf(ALT, isBlock),
        text: "a\nb",
      }),
    ).not.toBe("");
  });

  it("refuses to delete a branch that holds a global statement", () => {
    expect(
      refusal(ALT, { kind: "deleteBranch", target: targetOf(ALT, isBranch) }),
    ).toContain("unsupportedInRange");
  });
});

describe("more branches and messages", () => {
  const THREE = `sequenceDiagram
    alt one
        A->>B: a
    else two
        A->>B: b
    else three
        A->>B: c
    end
`;

  it("deletes a branch followed by another, keeping that one", () => {
    const result = run(THREE, {
      kind: "deleteBranch",
      target: targetOf(THREE, isBranch, 0),
    });
    expect(result).not.toContain("else two");
    expect(result).toContain("else three");
  });

  it("refuses an activation sign it does not know, and a stale message to copy", () => {
    expect(
      refusal(THREE, {
        kind: "setMessageActivation",
        target: targetOf(THREE, isMessage),
        sign: "*" as never,
      }),
    ).toContain("invalidSign");
    expect(
      refusal(THREE, { kind: "duplicateMessage", target: STALE }),
    ).not.toBe("");
  });
});

describe("activation pairing", () => {
  it("refuses taking away a + that an open activation relies on to stay open", () => {
    const source =
      "sequenceDiagram\n    activate A\n    B->>+A: x\n    deactivate A\n";
    expect(
      refusal(source, {
        kind: "setMessageActivation",
        target: targetOf(source, isMessage),
        sign: null,
      }),
    ).toContain("activationPairing");
  });
});
