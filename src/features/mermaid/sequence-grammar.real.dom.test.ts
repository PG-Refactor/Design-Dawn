// @vitest-environment jsdom
// Evidence for docs/architecture.md §16.16: how mermaid 12.1.0 reads sequence diagrams, and
// which of those inputs the domain (src/domain/diagram/sequence/) calls editable. Each case
// names a fact; the test name is the evidence cited in the docs. jsdom cannot lay text out,
// so "draws" means the real renderer and the SVG sanitiser accept it, not how it looks.
import { beforeAll, describe, expect, it } from "vitest";
import { SEQUENCE_MAX_SOURCE_LENGTH } from "../../domain/diagram/sequence/sequence-config";
import { sequenceEditability } from "../../domain/diagram/sequence/sequence-editability";
import { readSequence } from "../../domain/diagram/sequence/sequence-reader";
import type { SequenceOpaqueReason } from "../../domain/diagram/sequence/sequence-types";
import { createDiagramRenderCheck } from "./diagram-render-check";
import { mermaidRenderer } from "./render-mermaid";
import { installFakeSvgMeasurement } from "./test-support/mermaid-dom-setup";
import { readSequenceWithMermaid } from "./test-support/mermaid-sequence-db";
import {
  comparableOf,
  firstDifference,
} from "./test-support/sequence-comparison";

beforeAll(installFakeSvgMeasurement);

const renderCheck = createDiagramRenderCheck(mermaidRenderer);

interface GrammarCase {
  readonly name: string;
  readonly source: string;
  // Does mermaid 12.1.0 accept the text?
  readonly mermaid: boolean;
  // Does the domain call it editable? (false for an accepted input = "recognised, not
  // editable" or "refused", stated on purpose.)
  readonly editable: boolean;
  readonly reason?: string;
  // The reason of the first opaque statement, when the reason is unsupportedStatements.
  readonly opaque?: SequenceOpaqueReason;
  // An accepted input that the renderer cannot draw.
  readonly draws?: false;
}

const s = (body: string): string => `sequenceDiagram\n${body}\n`;

const good = (name: string, source: string): GrammarCase => ({
  name,
  source,
  mermaid: true,
  editable: true,
});
// Accepted by mermaid, refused by the reader as an opaque statement.
const opaque = (
  name: string,
  source: string,
  reason: SequenceOpaqueReason,
): GrammarCase => ({
  name,
  source,
  mermaid: true,
  editable: false,
  reason: "unsupportedStatements",
  opaque: reason,
});
// Rejected by mermaid; the reader must not call it editable.
const bad = (name: string, source: string): GrammarCase => ({
  name,
  source,
  mermaid: false,
  editable: false,
});
// Accepted by mermaid, refused with a whole-text reason.
const refused = (
  name: string,
  source: string,
  reason: string,
): GrammarCase => ({ name, source, mermaid: true, editable: false, reason });

function sourceOfLength(length: number): string {
  const frame = "sequenceDiagram\nA->>B: ";
  return `${frame}${"x".repeat(length - frame.length - 1)}\n`;
}

const CASES: readonly GrammarCase[] = [
  // ---- header and file level
  good("header: sequenceDiagram only", "sequenceDiagram\n"),
  good("header: no trailing newline", "sequenceDiagram"),
  good("header: trailing blanks", "sequenceDiagram   \nA->>B: x\n"),
  bad("header: the keyword is case-sensitive", "SequenceDiagram\nA->>B: x\n"),
  opaque(
    "header: a comment behind the keyword is a statement on the header line",
    "sequenceDiagram %% c\nA->>B: x\n",
    "statementOnHeaderLine",
  ),
  good("header: tab indent", "sequenceDiagram\n\tA->>B: x\n\tB->>A: y\n"),
  good("header: no indent", s("A->>B: x")),
  good("header: CRLF", "sequenceDiagram\r\n  A->>B: hi\r\n"),
  good("header: byte order mark", "﻿sequenceDiagram\n  A->>B: x\n"),
  good(
    "header: blank lines and a comment before it",
    "\n\n%% c\nsequenceDiagram\nA->>B: x\n",
  ),
  good(
    "front matter: title and config",
    "---\ntitle: T\nconfig:\n  sequence:\n    mirrorActors: false\n---\nsequenceDiagram\n  A->>B: x\n",
  ),
  good(
    "directive: on a line of its own before the header",
    '%%{init: {"theme":"neutral"}}%%\nsequenceDiagram\n  A->>B: x\n',
  ),
  good(
    "directive: on a line of its own after the header",
    'sequenceDiagram\n%%{init: {"theme":"neutral"}}%%\n  A->>B: x\n',
  ),
  refused(
    "directive: inside a message (mermaid applies it and removes it)",
    s('A->>B: x %%{init: {"theme":"dark"}}%%'),
    "inlineDirective",
  ),
  refused(
    "rewrite: a lone carriage return",
    "sequenceDiagram\r  A->>B: x\r  B->>A: y\r",
    "loneCarriageReturn",
  ),
  good(
    "rewrite: mixed line feed and CRLF is fine",
    "sequenceDiagram\r\n  A->>B: x\n  B->>A: y\r\n",
  ),
  refused(
    "rewrite: attribute quotes of a tag are changed",
    s('A->>B: <a href="x">y</a>'),
    "markupRewrite",
  ),
  good("rewrite: a tag without attributes is kept", s("A->>B: <b>x</b>")),
  // ---- comments and statement separators
  good("comment: %% line", s("%% c\nA->>B: x")),
  good("comment: indented %% line", s("    %% c\nA->>B: x")),
  good("comment: # line", s("# c\nA->>B: x")),
  good("comment: single % line", s("% c\nA->>B: x")),
  good(
    "comment: a trailing # cuts the message text",
    s("A->>B: x # tail\nB->>A: y"),
  ),
  good(
    "comment: a trailing %% is part of the message text",
    s("A->>B: x %% tail\nB->>A: y"),
  ),
  good(
    "comment: after ; it runs to the end of the line",
    s("A->>B: x; % c; B->>A: y"),
  ),
  good("separator: ; joins statements", s("A->>B: x; B->>A: y")),
  good("separator: trailing ;", s("A->>B: x;\nB->>A: y;")),
  good("separator: blank lines", s("\nA->>B: x\n\n\nB->>A: y\n")),
  // ---- participants
  good("participant: plain", s("participant A\nA->>B: x")),
  good("participant: actor", s("actor A\nA->>B: x")),
  good("participant: alias", s("participant A as Alice\nA->>B: x")),
  good(
    "participant: alias with spaces and parentheses",
    s("participant A as Alice (admin) the Great\nA->>B: x"),
  ),
  good(
    "participant: alias with a colon",
    s("participant A as Al:ice\nA->>B: x"),
  ),
  good(
    "participant: alias with an entity",
    s("participant A as Al#59;ice #35;1\nA->>B: x"),
  ),
  good(
    "participant: alias with <br/>",
    s("participant A as Alice<br/>Smith\nA->>B: x"),
  ),
  good(
    "participant: unicode alias and id",
    s("participant 太郎 as 太郎様\n太郎->>花子: こんにちは"),
  ),
  good(
    "participant: id with underscore and digits",
    s("participant a_1\na_1->>B2: x"),
  ),
  good(
    "participant: keyword text inside an id",
    s(
      "loopback->>B: x\nendpoint->>B: y\noptional->>B: z\nnotes->>B: w\ntitled->>B: v\naltitude->>B: u",
    ),
  ),
  opaque("participant: id 'end'", s("participant end"), "reservedWordAsId"),
  opaque(
    "participant: id upper-case LOOP",
    s("participant LOOP"),
    "reservedWordAsId",
  ),
  opaque(
    "participant: id 'as'",
    s("participant as\nas->>B: x"),
    "reservedWordAsId",
  ),
  opaque(
    "participant: id 'links'",
    s("participant links\nlinks->>B: x"),
    "reservedWordAsId",
  ),
  opaque(
    "participant: id with a space",
    s("participant Alice Smith\nAlice Smith->>B: x"),
    "unrecognisedStatement",
  ),
  opaque(
    "participant: id with a hyphen",
    s("participant web-app\nweb-app->>B: x"),
    "unrecognisedStatement",
  ),
  opaque(
    "participant: id with a dot",
    s("participant a.b\na.b->>B: x"),
    "unrecognisedStatement",
  ),
  opaque(
    "participant: id with an emoji",
    s("participant 😀\n😀->>B: x"),
    "unrecognisedStatement",
  ),
  opaque(
    "participant: a # in the declaration is part of the id",
    s("participant A # tail\nA->>B: x"),
    "hashInDeclaration",
  ),
  opaque(
    "participant: a trailing %% in the declaration is part of the id",
    s("participant A %% tail\nA->>B: x"),
    "unrecognisedStatement",
  ),
  opaque(
    "participant: alias with a wrap prefix",
    s("participant A as wrap:Alice\nA->>B: x"),
    "wrapPrefix",
  ),
  opaque(
    "participant: alias with a :wrap: prefix",
    s("participant A as :wrap:Alice\nA->>B: x"),
    "wrapPrefix",
  ),
  opaque(
    "participant: @{} declaration",
    s('participant A@{ "type": "database" }\nA->>B: m'),
    "unrecognisedStatement",
  ),
  refused(
    "participant: declared again with an alias",
    s("participant A as One\nparticipant A as Two\nA->>B: x"),
    "participantRedeclared",
  ),
  refused(
    "participant: declared after the first message",
    s("A->>B: x\nparticipant A as Alice"),
    "participantRedeclared",
  ),
  refused(
    "participant: declared twice",
    s("participant A\nparticipant A\nA->>B: x"),
    "participantRedeclared",
  ),
  good(
    "participant: declared after the first message but new",
    s("A->>B: x\nparticipant C\nparticipant D"),
  ),
  opaque(
    "participant: create",
    s("A->>B: x\ncreate participant C\nB->>C: new"),
    "createDestroy",
  ),
  opaque(
    "participant: destroy",
    s("A->>B: x\ndestroy B\nB-->>A: bye"),
    "createDestroy",
  ),
  opaque(
    "participant: box",
    s("box Team\nparticipant A\nend\nA->>B: x"),
    "boxStatement",
  ),
  // ---- arrows
  good("arrow: ->>", s("A->>B: t")),
  good("arrow: -->>", s("A-->>B: t")),
  good("arrow: ->", s("A->B: t")),
  good("arrow: -->", s("A-->B: t")),
  good("arrow: -x", s("A-xB: t")),
  good("arrow: --x", s("A--xB: t")),
  good("arrow: -)", s("A-)B: t")),
  good("arrow: --)", s("A--)B: t")),
  good("arrow: <<->>", s("A<<->>B: t")),
  good("arrow: <<-->>", s("A<<-->>B: t")),
  good("arrow: spaced", s("A ->> B: t")),
  good("arrow: self message", s("A->>A: self")),
  opaque("arrow: half arrow -|\\", s("A-|\\B: t"), "unrecognisedStatement"),
  opaque("arrow: half arrow --//", s("A--//B: t"), "unrecognisedStatement"),
  opaque("arrow: central connection", s("A->>()B: t"), "unrecognisedStatement"),
  bad("arrow: ->>> is not an arrow", s("A->>>B: t")),
  bad("arrow: no colon", s("A->>B")),
  bad("arrow: no target", s("A->>: t")),
  good("arrow: empty text", s("A->>B:")),
  // ---- activation
  good("activation: + and - on messages", s("A->>+B: call\nB-->>-A: back")),
  good("activation: nested", s("A->>+B: 1\nB->>+C: 2\nC-->>-B: 3\nB-->>-A: 4")),
  good(
    "activation: activate and deactivate",
    s("A->>B: x\nactivate B\nB->>C: y\ndeactivate B"),
  ),
  bad("activation: - without an open activation", s("A->>B: x\nB-->>-A: y")),
  bad(
    "activation: deactivate without an open activation",
    s("A->>B: x\ndeactivate B"),
  ),
  good("activation: + never closed", s("A->>+B: x\nB->>A: y")),
  {
    name: "activation: activate of a participant that never appears (mermaid parses, cannot draw)",
    source: s("activate Z\nA->>B: x"),
    mermaid: true,
    editable: false,
    reason: "invalidDiagram",
    draws: false,
  },
  // ---- message text
  good("text: colons", s("A->>B: a: b: c")),
  good("text: entities for ; and #", s("A->>B: a#59; b #35; c")),
  good("text: percent", s("A->>B: 50% done")),
  good("text: quotes", s('A->>B: say "hi"')),
  good("text: <br/>", s("A->>B: l1<br/>l2")),
  good("text: angle brackets and ampersand", s("A->>B: a < b > c & d")),
  good("text: brackets and braces", s("A->>B: [a] {b} (c)")),
  good("text: unicode", s("A->>B: こんにちは 😀")),
  good("text: plus and minus", s("A->>B: +x -y")),
  good("text: an arrow inside", s("A->>B: a->>b")),
  good(
    "text: a url with a # (cut at the #, the rest is a comment)",
    s("A->>B: http://x.example/a?b=c#d"),
  ),
  opaque("text: wrap: prefix", s("A->>B: wrap: long"), "wrapPrefix"),
  opaque("text: nowrap: prefix", s("A->>B: nowrap: long"), "wrapPrefix"),
  opaque("text: :wrap: prefix", s("A->>B: :wrap:long"), "wrapPrefix"),
  bad("text: next line is not a continuation", s("A->>B: t\ncontinued")),
  // ---- notes
  good("note: left of", s("participant A\nNote left of A: left")),
  good("note: right of", s("participant A\nNote right of A: right")),
  good("note: over one", s("participant A\nNote over A: over")),
  good(
    "note: over two",
    s("participant A\nparticipant B\nNote over A,B: both"),
  ),
  good(
    "note: over two with blanks",
    s("participant A\nparticipant B\nNote over A , B: both"),
  ),
  good("note: lower-case keyword", s("participant A\nnote over A: lower")),
  good("note: empty text", s("participant A\nNote over A:")),
  good("note: creates an unknown participant", s("Note over Z: n\nA->>B: x")),
  bad(
    "note: over three",
    s("participant A\nparticipant B\nparticipant C\nNote over A,B,C: three"),
  ),
  bad(
    "note: left of two",
    s("participant A\nparticipant B\nNote left of A,B: n"),
  ),
  bad("note: without a colon", s("participant A\nNote over A")),
  // ---- blocks
  good("block: loop", s("loop Every minute\nA->>B: ping\nend")),
  good("block: loop without text", s("loop\nA->>B: ping\nend")),
  good("block: alt else", s("alt ok\nA->>B: y\nelse bad\nA->>B: n\nend")),
  good(
    "block: alt with several else",
    s("alt a\nA->>B: 1\nelse b\nA->>B: 2\nelse c\nA->>B: 3\nend"),
  ),
  good("block: else without text", s("alt a\nA->>B: 1\nelse\nA->>B: 2\nend")),
  good("block: opt", s("opt maybe\nA->>B: x\nend")),
  good("block: par and", s("par one\nA->>B: p1\nand two\nA->>C: p2\nend")),
  good(
    "block: par_over",
    s("par_over one\nA->>B: p1\nand two\nA->>C: p2\nend"),
  ),
  good(
    "block: critical option",
    s("critical c\nA->>B: crit\noption fail\nA->>B: fb\nend"),
  ),
  good("block: break", s("break stop\nA->>B: brk\nend")),
  good(
    "block: rect with a colour",
    s("rect rgb(200,200,255)\nA->>B: in rect\nend"),
  ),
  good(
    "block: nested",
    s("loop a\nalt b\nA->>B: x\nelse c\nA->>B: y\nend\nend"),
  ),
  good("block: empty", s("loop L\nend\nA->>B: x")),
  good("block: upper-case keywords", s("LOOP L\nA->>B: x\nEND")),
  good("block: text with entities", s("loop a#59;b#35;c\nA->>B: x\nend")),
  bad("block: unclosed", s("loop L\nA->>B: x")),
  bad("block: end without a block", s("A->>B: x\nend")),
  bad("block: else outside a block", s("A->>B: x\nelse y")),
  bad("block: else in a loop", s("loop a\nA->>B: x\nelse b\nA->>B: y\nend")),
  bad("block: and in an alt", s("alt a\nA->>B: x\nand b\nA->>B: y\nend")),
  bad("block: option in an alt", s("alt a\nA->>B: x\noption b\nA->>B: y\nend")),
  bad("block: text behind end", s("loop L\nA->>B: x\nend trailing")),
  opaque(
    "block: wrap prefix in the text",
    s("loop wrap: long text\nA->>B: x\nend"),
    "wrapPrefix",
  ),
  // ---- autonumber, title and the rest
  good("autonumber: bare", s("autonumber\nA->>B: x")),
  good("autonumber: start", s("autonumber 10\nA->>B: x")),
  good("autonumber: start and step", s("autonumber 10 5\nA->>B: x")),
  good("autonumber: off", s("autonumber\nA->>B: x\nautonumber off\nB->>A: y")),
  good("autonumber: after a message", s("A->>B: x\nautonumber\nB->>A: y")),
  bad("autonumber: text after it", s("autonumber abc\nA->>B: x")),
  good("title: statement", s("title My Title\nA->>B: x")),
  good("title: colon form", s("title: My Title\nA->>B: x")),
  good("title: twice (the last is used)", s("title One\ntitle Two\nA->>B: x")),
  opaque(
    "accessibility: accTitle",
    s("accTitle: Acc Title\nA->>B: x"),
    "accessibilityStatement",
  ),
  opaque(
    "links: links",
    s('participant A\nlinks A: {"Dashboard": "https://x.invalid"}\nA->>B: x'),
    "linkStatement",
  ),
  opaque(
    "links: properties",
    s('participant A\nproperties A: {"class": "x"}\nA->>B: x'),
    "linkStatement",
  ),
  bad("unknown: a statement mermaid does not have", s("frobnicate\nA->>B: x")),
  // ---- limits
  good(
    "limit: exactly 50000 characters",
    sourceOfLength(SEQUENCE_MAX_SOURCE_LENGTH),
  ),
  {
    name: "limit: 50001 characters (mermaid parses; the render only shows an 'exceeded' diagram)",
    source: sourceOfLength(SEQUENCE_MAX_SOURCE_LENGTH + 1),
    mermaid: true,
    editable: false,
    reason: "sourceTooLong",
  },
];

describe("sequence grammar of mermaid 12.1.0", () => {
  it("has unique case names", () => {
    const names = CASES.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(CASES.map((entry) => [entry.name, entry] as const))(
    "%s",
    async (_name, entry) => {
      const reference = await readSequenceWithMermaid(entry.source);
      expect(reference.accepted, "mermaid").toBe(entry.mermaid);

      const reading = readSequence(entry.source);
      const editability = sequenceEditability(reading);
      expect(editability.editable, JSON.stringify(editability)).toBe(
        entry.editable,
      );
      if (!editability.editable) {
        if (entry.reason !== undefined) {
          expect(editability.reason).toBe(entry.reason);
        }
        if (entry.opaque !== undefined) {
          expect(reading.opaque[0]?.reason).toBe(entry.opaque);
        }
      }

      if (editability.editable) {
        // The invariant the whole editor stands on: what we call editable is accepted by
        // mermaid, and our reading of it equals mermaid's own.
        expect(reference.accepted).toBe(true);
        expect(reading.meaning).not.toBeNull();
        if (reference.accepted && reading.meaning !== null) {
          const difference = firstDifference(
            comparableOf(reading.meaning),
            reference.sequence,
          );
          expect(difference).toBeNull();
        }
      }
      if (editability.editable || entry.draws === false) {
        const drawn = await renderCheck(entry.source);
        expect(drawn.ok, JSON.stringify(drawn)).toBe(entry.draws !== false);
      }
      if (!reference.accepted) {
        expect(editability.editable).toBe(false);
      }
    },
    60_000,
  );

  it("the render gate alone misses a text longer than mermaid's limit", async () => {
    // Mermaid replaces a text over maxTextSize by an "exceeded" diagram and reports
    // success, so the editor has to check the length itself.
    const source = sourceOfLength(SEQUENCE_MAX_SOURCE_LENGTH + 1);
    expect(await renderCheck(source)).toEqual({ ok: true });
    const outcome = await mermaidRenderer.render(source, {});
    expect(outcome.ok).toBe(true);
    const visibleText = outcome.ok
      ? outcome.svg.replace(/<style>.*?<\/style>/s, "").replace(/<[^>]+>/g, " ")
      : "";
    expect(visibleText.replace(/\s+/g, " ")).toContain(
      "Maximum text size in diagram exceeded",
    );
    expect(sequenceEditability(readSequence(source))).toMatchObject({
      editable: false,
      reason: "sourceTooLong",
    });
  }, 60_000);
});
