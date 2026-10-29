import { describe, expect, it } from "vitest";
import { SEQUENCE_MAX_SOURCE_LENGTH } from "./sequence-config";
import { sequenceEditability } from "./sequence-editability";
import { assessSequence } from "./sequence-editor";
import { readSequence } from "./sequence-reader";

const s = (body: string) => `sequenceDiagram\n${body}\n`;
const check = (source: string) => sequenceEditability(readSequence(source));
const reasonOf = (source: string) => {
  const result = check(source);
  return result.editable ? "editable" : result.reason;
};

function ofLength(length: number): string {
  const frame = "sequenceDiagram\nA->>B: ";
  return `${frame}${"x".repeat(length - frame.length - 1)}\n`;
}

describe("sequenceEditability", () => {
  it("accepts an ordinary diagram", () => {
    expect(
      check(
        s(
          "participant A as Alice\nactor B\nA->>+B: hi\nNote over A,B: n\nloop l\nB-->>-A: ok\nend",
        ),
      ),
    ).toEqual({ editable: true });
  });

  it.each([
    ["notSequence", 'pie\n  "A" : 1\n'],
    ["notSequence", ""],
    ["notSequence", "SequenceDiagram\nA->>B: x\n"],
    ["sourceTooLong", ofLength(SEQUENCE_MAX_SOURCE_LENGTH + 1)],
    ["editable", ofLength(SEQUENCE_MAX_SOURCE_LENGTH)],
    [
      "structureIssue",
      '%%{init: {\n"theme": "dark"}}%%\nsequenceDiagram\nA->>B: x\n',
    ],
    ["structureIssue", "---\nnot yaml: [\n---\nsequenceDiagram\nA->>B: x\n"],
    ["loneCarriageReturn", "sequenceDiagram\rA->>B: x\r"],
    ["markupRewrite", s('A->>B: <a href="x">y</a>')],
    ["styleLikeText", s("A->>B: style x:#a; y")],
    ["inlineDirective", s('A->>B: x %%{init: {"theme":"dark"}}%%')],
    ["inlineDirective", s('%% note %%{init: {"theme":"dark"}}%%')],
    ["structureIssue", s('%%{init: {"theme":"dark"}}%% A->>B: x')],
    ["unsupportedStatements", s("A->>()B: x")],
    ["unsupportedStatements", s("box T\nparticipant A\nend")],
    ["unsupportedStatements", s("create participant C\nA->>C: x")],
    ["invalidDiagram", s("A->>B: x\nend")],
    ["invalidDiagram", s("activate Z\nA->>B: x")],
    ["participantRedeclared", s("A->>B: x\nparticipant A as Alice")],
    ["participantRedeclared", s("participant A\nparticipant A\nA->>B: x")],
  ])("%s", (reason, source) => {
    expect(reasonOf(source)).toBe(reason);
  });

  it("accepts a directive on its own line, front matter and comments", () => {
    const source =
      '---\ntitle: T\nconfig:\n  theme: forest\n---\n%%{init: {"sequence": {"mirrorActors": false}}}%%\nsequenceDiagram\n%% c\n# c\nA->>B: x\n';
    expect(check(source)).toEqual({ editable: true });
  });

  it("lists the opaque statements with their lines", () => {
    const result = check(s("A->>B: x\nframe\nC->>D: y\nA->>()B: z"));
    expect(result).toMatchObject({
      editable: false,
      reason: "unsupportedStatements",
    });
    if (result.editable) return;
    expect(result.lines.map((line) => line.index)).toEqual([2, 4]);
  });

  it("assessSequence reports the same decision for the common layer", () => {
    expect(assessSequence(s("A->>B: x"))).toEqual({ editable: true });
    expect(assessSequence(s("box T\nend"))).toMatchObject({
      editable: false,
      reason: "unsupportedStatements",
      unsupported: [{ index: 1 }],
    });
    expect(assessSequence(s("A->>B: x\nend"))).toMatchObject({
      editable: false,
      reason: "invalidDiagram",
      unsupported: [],
    });
  });
});
