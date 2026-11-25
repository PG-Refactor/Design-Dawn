import { describe, expect, it } from "vitest";
import { applyTextEdits } from "../text-edit";
import {
  planStateOperation,
  readState,
  STATE_EDITOR,
  type StateOperation,
  type StateTransition,
  transitionText,
  verifyStateCandidate,
} from "./state-diagram";

const SOURCE = `stateDiagram-v2
    direction LR
    [*] --> Idle
    Idle --> Busy : start
    Busy : working
    state "Waiting for input" as Waiting
    Lonely
    state Hidden
`;

function apply(source: string, operation: StateOperation): string {
  const plan = planStateOperation(source, operation);
  if (!plan.ok) throw new Error(`refused: ${plan.error.detail}`);
  const applied = applyTextEdits(source, plan.value.edits);
  if (!applied.ok) throw new Error(applied.error.detail);
  const verified = verifyStateCandidate(
    applied.value.text,
    plan.value.expected,
  );
  if (!verified.ok) throw new Error(`not verified: ${verified.error.kind}`);
  return applied.value.text;
}

function refusal(source: string, operation: StateOperation): string {
  const plan = planStateOperation(source, operation);
  return plan.ok ? "" : plan.error.detail;
}

const TRANSITION: StateTransition = { from: "Busy", to: "[*]", label: "" };

describe("reading a state diagram", () => {
  it("reads states with their descriptions, transitions, and what Mermaid does not draw", () => {
    const read = readState(SOURCE);
    expect(read.editable).toBe(true);
    expect(read.meaning.states).toEqual([
      { id: "Idle", description: "" },
      { id: "Busy", description: "working" },
      { id: "Waiting", description: "Waiting for input" },
      { id: "Lonely", description: "" },
      { id: "Hidden", description: "" },
    ]);
    expect(read.meaning.transitions[1]).toEqual({
      from: "Idle",
      to: "Busy",
      label: "start",
    });
    expect([...read.undrawn]).toEqual(["Hidden"]);
  });

  it("reads the old header too, and not other headers or front matter", () => {
    expect(readState("stateDiagram\n    A --> B\n").editable).toBe(true);
    expect(readState("").notReadable?.reason).toBe("unsupportedLines");
    expect(
      readState("---\ntitle: T\n---\nstateDiagram-v2\n    A\n").notReadable
        ?.reason,
    ).toBe("structureIssue");
  });

  it.each([
    ["a second description", "    A : one\n    A : two\n"],
    ["a composite state", "    state A {\n    }\n"],
  ])("is not editable with %s", (_what, body) => {
    expect(readState(`stateDiagram-v2\n${body}`).editable).toBe(false);
  });
});

describe("transition text", () => {
  it("writes a label only when there is one", () => {
    expect(transitionText(TRANSITION)).toBe("Busy --> [*]");
    expect(transitionText({ ...TRANSITION, label: "done" })).toBe(
      "Busy --> [*] : done",
    );
  });
});

describe("state operations", () => {
  it("refuses everything on a diagram it cannot edit", () => {
    expect(
      refusal("stateDiagram-v2\n    state A {\n", {
        kind: "addState",
        state: { id: "B", description: "" },
      }),
    ).toContain("notEditable");
  });

  it("adds a state with or without a description, refusing bad input", () => {
    expect(
      apply(SOURCE, {
        kind: "addState",
        state: { id: "Done", description: "" },
      }),
    ).toContain("    Done\n");
    expect(
      apply(SOURCE, {
        kind: "addState",
        state: { id: "Done", description: "all good" },
      }),
    ).toContain("    Done : all good\n");
    expect(
      refusal(SOURCE, {
        kind: "addState",
        state: { id: "a b", description: "" },
      }),
    ).toContain("invalidName");
    expect(
      refusal(SOURCE, {
        kind: "addState",
        state: { id: "Idle", description: "" },
      }),
    ).toContain("duplicateName");
    expect(
      refusal(SOURCE, {
        kind: "addState",
        state: { id: "Done", description: "{" },
      }),
    ).toContain("invalidText");
  });

  it("changes a description on its line, or adds a line for a state only transitions name", () => {
    expect(
      apply(SOURCE, {
        kind: "updateState",
        state: { id: "Busy", description: "on it" },
      }),
    ).toContain("    Busy : on it\n");
    expect(
      apply(SOURCE, {
        kind: "updateState",
        state: { id: "Idle", description: "resting" },
      }),
    ).toContain("    Idle : resting\n");
    expect(
      refusal(SOURCE, {
        kind: "updateState",
        state: { id: "Nope", description: "" },
      }),
    ).toContain("unknownState");
    expect(
      refusal(SOURCE, {
        kind: "updateState",
        state: { id: "Busy", description: '"' },
      }),
    ).toContain("invalidText");
  });

  it("deletes a state no transition names", () => {
    expect(apply(SOURCE, { kind: "deleteState", id: "Lonely" })).not.toContain(
      "Lonely",
    );
    expect(refusal(SOURCE, { kind: "deleteState", id: "Idle" })).toContain(
      "stateInUse",
    );
    expect(refusal(SOURCE, { kind: "deleteState", id: "Nope" })).toContain(
      "unknownState",
    );
  });

  it("adds, changes and deletes transitions", () => {
    const added = apply(SOURCE, {
      kind: "addTransition",
      transition: TRANSITION,
    });
    expect(added).toContain("    Busy --> [*]\n");
    expect(
      apply(SOURCE, {
        kind: "updateTransition",
        index: 1,
        transition: { from: "Idle", to: "Gone", label: "leave" },
      }),
    ).toContain("    Idle --> Gone : leave\n");
    // Busy keeps its own line; a state named only by the deleted transition goes.
    expect(
      readState(apply(added, { kind: "deleteTransition", index: 2 })).meaning
        .states.length,
    ).toBe(5);
    expect(
      refusal(SOURCE, {
        kind: "updateTransition",
        index: 7,
        transition: TRANSITION,
      }),
    ).toContain("unknownTransition");
    expect(refusal(SOURCE, { kind: "deleteTransition", index: 7 })).toContain(
      "unknownTransition",
    );
  });

  it.each([
    ["a bad start", { from: "1" }, "invalidName"],
    ["a bad end", { to: "a b" }, "invalidName"],
    ["a brace in the label", { label: "}" }, "invalidText"],
  ])("refuses a transition with %s", (_what, change, reason) => {
    expect(
      refusal(SOURCE, {
        kind: "addTransition",
        transition: { ...TRANSITION, ...change },
      }),
    ).toContain(reason);
    expect(
      refusal(SOURCE, {
        kind: "updateTransition",
        index: 0,
        transition: { ...TRANSITION, ...change },
      }),
    ).toContain(reason);
  });
});

describe("the state editor entry", () => {
  it("assesses a diagram", () => {
    expect(STATE_EDITOR.type).toBe("state");
    expect(STATE_EDITOR.assess(SOURCE)).toEqual({ editable: true });
    expect(
      STATE_EDITOR.assess("stateDiagram-v2\n    A : 1\n    A : 2\n").editable,
    ).toBe(false);
  });
});
