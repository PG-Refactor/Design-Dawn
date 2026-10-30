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
});
