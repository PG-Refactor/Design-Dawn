import { describe, expect, it } from "vitest";
import { readSequenceView } from "./sequence-view";

const view = (source: string) => {
  const result = readSequenceView(source);
  if (result === null) throw new Error("not editable");
  return result;
};

describe("readSequenceView", () => {
  it("is null for a diagram the editor does not edit", () => {
    expect(readSequenceView("sequenceDiagram\n  A->>()B: x\n")).toBeNull();
    expect(readSequenceView('pie\n  "A" : 1\n')).toBeNull();
  });

  it("lists participants with decoded labels and kinds", () => {
    const result = view(
      "sequenceDiagram\n  participant A as Al#59;ice\n  actor B\n  A->>C: x\n",
    );
    expect(
      result.participants.map(
        (participant) =>
          `${participant.id}/${participant.displayLabel}/${participant.kind}/${participant.restriction}`,
      ),
    ).toEqual([
      "A/Al;ice/participant/null",
      "B/B/actor/null",
      "C/C/participant/null",
    ]);
  });

  it("lists entries in order with block depth and decoded text", () => {
    const result = view(
      "sequenceDiagram\n  A->>B: a#35;1<br/>b\n  alt ok\n    A->>+B: x\n    B-->>-A: y\n  else no\n    Note left of A: n\n  end\n",
    );
    expect(
      result.entries.map(
        (entry) =>
          `${entry.kind}@${entry.depth}${"displayText" in entry ? `:${entry.displayText}` : ""}`,
      ),
    ).toEqual([
      "message@0:a#1\nb",
      "blockStart@0:ok",
      "message@1:x",
      "message@1:y",
      "branch@0:no",
      "note@1:n",
      "blockEnd@0",
    ]);
    const signs = result.entries.flatMap((entry) =>
      entry.kind === "message" ? [entry.activation] : [],
    );
    expect(signs).toEqual([null, "+", "-"]);
  });

  it("says why a control is unavailable by planning the operation", () => {
    const result = view(
      "sequenceDiagram\n  A->>+B: x\n  B-->>-A: y\n  rect rgb(1,2,3)\n    A->>B: z\n  end\n",
    );
    const [first, , rect] = result.entries;
    expect(first).toMatchObject({
      kind: "message",
      deleteRestriction: "activationSign",
      moveDownRestriction: "activationSign",
    });
    expect(rect).toMatchObject({
      kind: "blockStart",
      textRestriction: "colourBlock",
    });
  });

  it("reports the autonumber and title state", () => {
    expect(view("sequenceDiagram\n  A->>B: x\n").autonumber.state).toBe("off");
    expect(
      view("sequenceDiagram\n  autonumber\n  A->>B: x\n").autonumber.state,
    ).toBe("on");
    expect(
      view("sequenceDiagram\n  autonumber 5\n  A->>B: x\n").autonumber,
    ).toEqual({ state: "custom", restriction: "autonumberNotBare" });
    expect(view("sequenceDiagram\n  title T#59; 1\n  A->>B: x\n").title).toBe(
      "T; 1",
    );
    expect(
      view("sequenceDiagram\n  title One\n  title Two\n  A->>B: x\n")
        .titleRestriction,
    ).toBe("multipleTitles");
  });

  it("marks a text with foreign entities as restricted", () => {
    const result = view("sequenceDiagram\n  A->>B: say #quot;hi#quot;\n");
    expect(result.entries[0]).toMatchObject({
      kind: "message",
      textRestriction: "entityLikeText",
    });
  });

  it("says why a participant cannot be deleted or moved (Tier 2)", () => {
    const result = view(
      "sequenceDiagram\n  participant A\n  participant B\n  A->>+B: x\n  Note over A,B: n\n  B-->>-A: y\n",
    );
    const [first, second] = result.participants;
    expect(first).toMatchObject({
      deleteRestriction: "noteSpansParticipants",
      moveLeftRestriction: "atBoundary",
      moveRightRestriction: null,
    });
    expect(second).toMatchObject({
      moveLeftRestriction: null,
      moveRightRestriction: "atBoundary",
    });
  });

  it("offers the choices of a message and says which are refused (Tier 2)", () => {
    const result = view(
      "sequenceDiagram\n  A->>+B: x\n  B->>+C: y\n  C-->>-B: z\n  B-->>-A: w\n",
    );
    const [x, y] = result.entries;
    expect(x).toMatchObject({
      kind: "message",
      duplicateRestriction: null,
      // The - of `w` would lose its +.
      activationRestrictions: {
        "+": null,
        "-": "activationPairing",
        none: "activationPairing",
      },
    });
    expect(y).toMatchObject({
      activationRestrictions: { none: "activationPairing" },
    });
  });

  it("lists where a wrapped range may end and what a block or branch can do (Tier 2)", () => {
    const result = view(
      "sequenceDiagram\n  A->>B: 1\n  alt a\n    A->>B: 2\n  else b\n    A->>B: 3\n  end\n  loop l\n    A->>B: 4\n  end\n  A->>B: 5\n",
    );
    const entry = (position: number) => result.entries[position];
    const first = entry(0);
    if (first?.kind !== "message") throw new Error("expected a message");
    // `1`, the whole alt, the whole loop and `5`; nothing inside a block.
    expect(first.wrapEnds.map((end) => end.index)).toEqual([0, 1, 6, 9]);
    const alt = entry(1);
    if (alt?.kind !== "blockStart") throw new Error("expected a block");
    expect(alt).toMatchObject({
      branchKeyword: "else",
      unwrapRestriction: "hasBranches",
      addBranchRestriction: null,
      wrapRestriction: null,
    });
    const loop = entry(6);
    expect(loop).toMatchObject({
      kind: "blockStart",
      branchKeyword: null,
      unwrapRestriction: null,
      addBranchRestriction: "noBranches",
    });
    const inside = entry(2);
    if (inside?.kind !== "message") throw new Error("expected a message");
    // A range inside a branch ends at the end of that branch.
    expect(inside.wrapEnds.map((end) => end.index)).toEqual([2]);
    expect(entry(3)).toMatchObject({ kind: "branch", deleteRestriction: null });
  });
});
