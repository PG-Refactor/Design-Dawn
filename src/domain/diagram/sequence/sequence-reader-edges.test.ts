import { describe, expect, it } from "vitest";
import { describeSequenceDifferences } from "./sequence-meaning";
import { prepareSequence, resolveItem } from "./sequence-operation-support";
import { planSequenceOperation } from "./sequence-operations";
import { readSequence } from "./sequence-reader";

const reasonsOf = (body: string) =>
  readSequence(`sequenceDiagram\n${body}\n`).opaque.map(
    (entry) => entry.reason,
  );

describe("statements the reader keeps but does not understand", () => {
  it.each([
    ["activate end", "reservedWordAsId"],
    ["Note over end: x", "reservedWordAsId"],
    ["Note over A: wrap: x", "wrapPrefix"],
    ["loop wrap: x\nend", "wrapPrefix"],
    ["alt x\nelse wrap: y\nend", "wrapPrefix"],
  ])("%s", (body, reason) => {
    expect(reasonsOf(body)).toContain(reason);
  });

  it("reads a header line that starts with a separator as text on the header line", () => {
    const reading = readSequence(";sequenceDiagram\nA->>B: x\n");
    expect(reading.isSequence).toBe(false);
  });
});

describe("meaning differences", () => {
  it("names the first entry that differs, and the end of the shorter list", () => {
    const one = prepareSequence("sequenceDiagram\nA->>B: x\n");
    const two = prepareSequence("sequenceDiagram\nA->>B: x\nB->>A: y\n");
    if (!one.ok || !two.ok) throw new Error("unreadable");
    expect(
      describeSequenceDifferences(one.value.meaning, two.value.meaning).join(),
    ).toContain("(end)");
    expect(
      describeSequenceDifferences(two.value.meaning, one.value.meaning).join(),
    ).toContain("(end)");
  });
});

describe("deleting a participant", () => {
  it("takes its activations along", () => {
    const source =
      "sequenceDiagram\nparticipant A\nparticipant B\nactivate A\nactivate B\nB->>B: x\ndeactivate B\ndeactivate A\n";
    const plan = planSequenceOperation(source, {
      kind: "deleteParticipant",
      participantId: "A",
    });
    expect(plan.ok).toBe(true);
  });
});

describe("targets", () => {
  it("refuses an index that is not a whole number", () => {
    const prepared = prepareSequence("sequenceDiagram\nA->>B: x\n");
    if (!prepared.ok) throw new Error("unreadable");
    expect(
      resolveItem(prepared.value, { index: 0.5, fingerprint: "" }, ["message"])
        .ok,
    ).toBe(false);
  });
});
