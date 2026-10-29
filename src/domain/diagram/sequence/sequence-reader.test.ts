import { describe, expect, it } from "vitest";
import { SEQUENCE_ARROWS } from "./sequence-config";
import { readSequence } from "./sequence-reader";
import type { SequenceStatement } from "./sequence-types";

const corpusFiles = import.meta.glob(
  "/fixtures/mermaid-gui/sequence-corpus.json",
  { import: "default", eager: true },
) as Record<string, { cases: readonly { id: string; source: string }[] }>;

const s = (body: string) => `sequenceDiagram\n${body}\n`;
const meaningOf = (source: string) => {
  const reading = readSequence(source);
  if (reading.meaning === null) {
    throw new Error(
      `no meaning: ${JSON.stringify(reading.opaque)} ${JSON.stringify(reading.invalid)} ${JSON.stringify(reading.sourceIssues)}`,
    );
  }
  return reading.meaning;
};
const statementOf = <K extends SequenceStatement["kind"]>(
  source: string,
  kind: K,
): Extract<SequenceStatement, { kind: K }> => {
  const found = readSequence(source).statements.find(
    (statement) => statement.kind === kind,
  );
  if (found === undefined) throw new Error(`no ${kind} statement`);
  return found as Extract<SequenceStatement, { kind: K }>;
};

describe("sequence reader: statements and spans", () => {
  it("reads a participant declaration with the spans of its tokens", () => {
    const source = s("  participant A as Alice the Great");
    const statement = statementOf(source, "participant");
    expect(statement.declaration).toBe("participant");
    expect(statement.id).toEqual({ text: "A", span: { start: 30, end: 31 } });
    expect(statement.alias?.text).toBe("Alice the Great");
    expect(
      source.slice(statement.alias?.span.start, statement.alias?.span.end),
    ).toBe("Alice the Great");
    expect(statement.keyword.text).toBe("participant");
  });

  it("reads an actor, case-insensitively", () => {
    const statement = statementOf(s("ACTOR U as User"), "participant");
    expect(statement.declaration).toBe("actor");
    expect(statement.keyword.text).toBe("ACTOR");
  });

  it.each(SEQUENCE_ARROWS)(
    "reads the arrow %s with and without blanks",
    (arrow) => {
      for (const source of [s(`A ${arrow} B: t`), s(`A${arrow}B: t`)]) {
        const statement = statementOf(source, "message");
        expect(statement.arrow.text).toBe(arrow);
        expect(statement.arrowValue).toBe(arrow);
        expect(statement.messageText.text).toBe("t");
      }
    },
  );

  it("reads the activation signs and the text span", () => {
    const source = s("A->>+B: call\nB-->>-A: done");
    const [first, second] = readSequence(source).statements;
    expect(first).toMatchObject({ kind: "message", sign: { text: "+" } });
    expect(second).toMatchObject({ kind: "message", sign: { text: "-" } });
    const text = (
      first as { messageText: { span: { start: number; end: number } } }
    ).messageText.span;
    expect(source.slice(text.start, text.end)).toBe("call");
  });

  it("gives an empty text a point to write at", () => {
    const source = s("A->>B:");
    const statement = statementOf(source, "message");
    expect(statement.messageText.text).toBe("");
    expect(statement.messageText.span.start).toBe(statement.span.end);
    expect(statement.messageText.span.end).toBe(statement.span.end);
  });

  it("reads notes with one or two participants", () => {
    const over = statementOf(s("Note over A,B: n"), "note");
    expect(over.placement).toBe("over");
    expect(over.ids.map((id) => id.text)).toEqual(["A", "B"]);
    const left = statementOf(s("note left of A: n"), "note");
    expect(left.placement).toBe("leftOf");
    expect(left.placementToken.text).toBe("left of");
    const right = statementOf(s("NOTE right of A: n"), "note");
    expect(right.placement).toBe("rightOf");
  });

  it("reads blocks, branches and end with their labels", () => {
    const reading = readSequence(
      s("alt ok\nA->>B: y\nelse\nA->>B: n\nend\nloop\nend"),
    );
    expect(
      reading.statements.map((statement) =>
        statement.kind === "blockStart"
          ? `${statement.block}:${statement.label.text}`
          : statement.kind === "branch"
            ? `${statement.branch}:${statement.label.text}`
            : statement.kind,
      ),
    ).toEqual([
      "alt:ok",
      "message",
      "else:",
      "message",
      "blockEnd",
      "loop:",
      "blockEnd",
    ]);
    expect(reading.invalid).toBeNull();
  });

  it("reads autonumber forms and titles", () => {
    expect(statementOf(s("autonumber"), "autonumber")).toMatchObject({
      visible: true,
      bare: true,
      start: null,
    });
    expect(statementOf(s("autonumber 10 5"), "autonumber")).toMatchObject({
      start: 10,
      step: 5,
      bare: false,
    });
    expect(statementOf(s("autonumber 10"), "autonumber")).toMatchObject({
      start: 10,
      step: 1,
    });
    expect(statementOf(s("autonumber off"), "autonumber")).toMatchObject({
      visible: false,
    });
    expect(statementOf(s("title My Title"), "title").title.text).toBe(
      "My Title",
    );
    expect(statementOf(s("title: My Title"), "title").title.text).toBe(
      "My Title",
    );
  });

  it("splits statements at ';' and stops at a '#' comment", () => {
    const reading = readSequence(s("A->>B: one; B->>A: two # tail ; C->>D: x"));
    expect(
      reading.statements.map((statement) =>
        statement.kind === "message" ? statement.messageText.text : "?",
      ),
    ).toEqual(["one", "two"]);
  });

  it("does not split at ';' or '#' inside an entity", () => {
    const statement = statementOf(s("A->>B: a#59; b #35; c"), "message");
    expect(statement.messageText.text).toBe("a#59; b #35; c");
  });

  it("keeps a trailing '%%' as part of a message text", () => {
    const statement = statementOf(s("A->>B: x %% tail"), "message");
    expect(statement.messageText.text).toBe("x %% tail");
  });

  it("reads comment lines, comments after ';', directives and front matter", () => {
    const source =
      '---\ntitle: T\nconfig:\n  theme: forest\n---\n%%{init: {"theme": "dark"}}%%\nsequenceDiagram\n%% c\n# c\n% c\n  A->>B: x; % c; B->>A: not read\n';
    const reading = readSequence(source);
    expect(reading.statements).toHaveLength(1);
    expect(reading.meaning?.title).toBe("");
  });

  it("uses the last title", () => {
    expect(meaningOf(s("title One\ntitle Two\nA->>B: x")).title).toBe("Two");
  });
});

describe("sequence reader: opaque statements", () => {
  it.each([
    ["half arrow", "A-|\\B: t", "unrecognisedStatement"],
    ["central connection", "A->>()B: t", "unrecognisedStatement"],
    ["box", "box Team\nparticipant A\nend", "boxStatement"],
    ["create", "create participant C\nA->>C: x", "createDestroy"],
    ["destroy", "A->>B: x\ndestroy B\nB-->>A: y", "createDestroy"],
    ["links", "participant A\nlinks A: {}", "linkStatement"],
    ["accessibility", "accTitle: x", "accessibilityStatement"],
    ["reserved id", "participant end", "reservedWordAsId"],
    ["reserved sender", "Loop->>B: x", "reservedWordAsId"],
    ["wrap prefix in text", "A->>B: wrap: x", "wrapPrefix"],
    ["wrap prefix in alias", "participant A as :wrap:x", "wrapPrefix"],
    ["wrap prefix in a block", "loop nowrap: x\nend", "wrapPrefix"],
    ["hash in a declaration", "participant A # c", "hashInDeclaration"],
    ["id with a space", "participant Big One", "unrecognisedStatement"],
    ["id with a hyphen", "web-app->>B: x", "unrecognisedStatement"],
    [
      "@{} declaration",
      'participant A@{ "type": "database" }',
      "unrecognisedStatement",
    ],
    ["note over three", "Note over A,B,C: x", "unrecognisedStatement"],
    ["left of two", "Note left of A,B: x", "unrecognisedStatement"],
    ["empty alias", "participant A as", "unrecognisedStatement"],
    ["unknown statement", "frobnicate", "unrecognisedStatement"],
  ])("%s", (_name, body, reason) => {
    const reading = readSequence(s(body));
    expect(reading.opaque.map((entry) => entry.reason)).toContain(reason);
    expect(reading.meaning).toBeNull();
  });

  it("refuses a statement on the header line", () => {
    const reading = readSequence("sequenceDiagram; A->>B: x\n");
    expect(reading.opaque[0]?.reason).toBe("statementOnHeaderLine");
    expect(reading.meaning).toBeNull();
    const other = readSequence("sequenceDiagram  %% c\nA->>B: x\n");
    expect(other.opaque[0]?.reason).toBe("statementOnHeaderLine");
  });

  it("records where the opaque statement is", () => {
    const source = s("A->>B: x\n  frobnicate  ");
    const [entry] = readSequence(source).opaque;
    expect(entry?.lineIndex).toBe(2);
    expect(source.slice(entry?.span.start, entry?.span.end)).toBe("frobnicate");
  });
});

describe("sequence meaning", () => {
  it("lists participants in the order of their first mention", () => {
    const meaning = meaningOf(
      s("participant A as Alice\nB->>A: x\nNote over C,B: n\nactor D"),
    );
    expect(
      meaning.participants.map(
        (participant) =>
          `${participant.id}/${participant.label}/${participant.kind}/${participant.declared}`,
      ),
    ).toEqual([
      "A/Alice/participant/true",
      "B/B/participant/false",
      "C/C/participant/false",
      "D/D/actor/true",
    ]);
    expect(meaning.layoutChainConsistent).toBe(true);
  });

  it("adds an activation entry after a message with a sign", () => {
    const meaning = meaningOf(s("A->>+B: call\nB-->>-A: back"));
    expect(meaning.items.map((item) => item.kind)).toEqual([
      "message",
      "activation",
      "message",
      "activation",
    ]);
    expect(meaning.items[1]).toMatchObject({
      active: true,
      participant: "B",
      viaSign: true,
    });
    expect(meaning.items[3]).toMatchObject({
      active: false,
      participant: "B",
    });
  });

  it("flags a participant declared again", () => {
    const meaning = meaningOf(s("A->>B: x\nparticipant A as Alice"));
    expect(meaning.redeclaredParticipants).toEqual(["A"]);
    expect(meaning.layoutChainConsistent).toBe(false);
  });

  it.each([
    ["end without a block", "A->>B: x\nend", "endWithoutBlock"],
    ["else in a loop", "loop x\nelse y\nend", "branchOutsideItsBlock"],
    ["and in an alt", "alt x\nand y\nend", "branchOutsideItsBlock"],
    ["option in an alt", "alt x\noption y\nend", "branchOutsideItsBlock"],
    ["unclosed block", "loop x\nA->>B: y", "unclosedBlock"],
    [
      "deactivate without activate",
      "A->>B: x\ndeactivate B",
      "deactivationWithoutActivation",
    ],
    ["'-' without activation", "A->>-B: x", "deactivationWithoutActivation"],
    [
      "activate of an unknown participant",
      "activate Z\nA->>B: x",
      "activationOfUnknownParticipant",
    ],
  ])("rejects %s", (_name, body, reason) => {
    const reading = readSequence(s(body));
    expect(reading.invalid?.reason).toBe(reason);
    expect(reading.meaning).toBeNull();
  });

  it("accepts branches in their blocks and nested blocks", () => {
    expect(
      readSequence(
        s(
          "par a\nA->>B: 1\nand b\nA->>B: 2\nend\ncritical c\nA->>B: x\noption o\nA->>B: y\nend\nloop l\nalt a\nA->>B: z\nelse b\nA->>B: w\nend\nend",
        ),
      ).invalid,
    ).toBeNull();
  });
});

describe("sequence reader: lossless over the research corpus", () => {
  it("every token text is exactly its slice of the source", () => {
    const cases = Object.values(corpusFiles)[0]?.cases ?? [];
    expect(cases.length).toBe(580);
    for (const entry of cases) {
      const reading = readSequence(entry.source);
      for (const statement of reading.statements) {
        expect(
          entry.source.slice(statement.span.start, statement.span.end),
          entry.id,
        ).toBe(statement.text);
        const tokens: { text: string; span: { start: number; end: number } }[] =
          [];
        if (statement.kind === "message") {
          tokens.push(
            statement.from,
            statement.arrow,
            statement.to,
            statement.messageText,
          );
          if (statement.sign !== null) tokens.push(statement.sign);
        } else if (statement.kind === "participant") {
          tokens.push(statement.keyword, statement.id);
          if (statement.alias !== null) tokens.push(statement.alias);
        } else if (statement.kind === "note") {
          tokens.push(
            statement.placementToken,
            ...statement.ids,
            statement.noteText,
          );
        } else if (
          statement.kind === "blockStart" ||
          statement.kind === "branch"
        ) {
          tokens.push(statement.keyword, statement.label);
        } else if (statement.kind === "title") {
          tokens.push(statement.title);
        } else if (statement.kind === "activation") {
          tokens.push(statement.id);
        }
        for (const token of tokens) {
          expect(
            entry.source.slice(token.span.start, token.span.end),
            entry.id,
          ).toBe(token.text);
          expect(token.span.start).toBeGreaterThanOrEqual(statement.span.start);
          expect(token.span.end).toBeLessThanOrEqual(statement.span.end);
        }
      }
    }
  });
});
