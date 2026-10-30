import {
  isSequenceReservedWord,
  SEQUENCE_NOTE_PLACEMENT_WORDS,
  SEQUENCE_PARTICIPANT_KINDS,
  SEQUENCE_STATEMENT_PATTERNS,
  SEQUENCE_WRAP_PREFIX_PATTERN,
  type SequenceArrow,
  type SequenceBlock,
  type SequenceBranch,
  type SequenceNotePlacement,
  type SequenceParticipantKind,
} from "./sequence-config";
import { autonumberStep } from "./sequence-meaning";
import type {
  SequenceOpaqueReason,
  SequenceSpan,
  SequenceStatement,
  SequenceToken,
} from "./sequence-types";

// Turns one trimmed statement (the text between two separators, without a trailing `#`
// comment) into a statement with the absolute span of every token, or says why it cannot.
// Only what is understood completely is returned: anything else is opaque.

export type StatementParse =
  | { readonly ok: true; readonly statement: SequenceStatement }
  | { readonly ok: false; readonly reason: SequenceOpaqueReason };

const refuse = (reason: SequenceOpaqueReason): StatementParse => ({
  ok: false,
  reason,
});

export interface StatementWhere {
  readonly text: string;
  // Absolute offset of the first character of `text`.
  readonly start: number;
  readonly lineIndex: number;
  readonly index: number;
}

interface StatementBase {
  readonly index: number;
  readonly lineIndex: number;
  readonly text: string;
  readonly span: SequenceSpan;
}

function baseOf(where: StatementWhere): StatementBase {
  return {
    index: where.index,
    lineIndex: where.lineIndex,
    text: where.text,
    span: { start: where.start, end: where.start + where.text.length },
  };
}

// The token of a capture group. An optional group that did not take part is an empty token at
// the end of the statement: the place where its text would be written.
function tokenOf(
  where: StatementWhere,
  match: RegExpExecArray,
  group: number,
): SequenceToken {
  const range = match.indices?.[group];
  const text = match[group];
  if (range === undefined || text === undefined) {
    const end = where.start + where.text.length;
    return { text: "", span: { start: end, end } };
  }
  return {
    text,
    span: { start: where.start + range[0], end: where.start + range[1] },
  };
}

function optionalTokenOf(
  where: StatementWhere,
  match: RegExpExecArray,
  group: number,
): SequenceToken | null {
  return match[group] === undefined ? null : tokenOf(where, match, group);
}

function hasReservedId(tokens: readonly SequenceToken[]): boolean {
  return tokens.some((token) => isSequenceReservedWord(token.text));
}

function hasWrapPrefix(token: SequenceToken): boolean {
  return SEQUENCE_WRAP_PREFIX_PATTERN.test(token.text);
}

const NOTE_PLACEMENT_BY_WORD = new Map<string, SequenceNotePlacement>(
  (
    Object.entries(SEQUENCE_NOTE_PLACEMENT_WORDS) as [
      SequenceNotePlacement,
      string,
    ][]
  ).map(([placement, word]) => [word, placement]),
);

const parsed = (statement: SequenceStatement): StatementParse => ({
  ok: true,
  statement,
});

// Each parser answers null when the text is not its kind of statement, so the next one is
// tried; the order is the order Mermaid's lexer tries them (a message before a block, so an
// id such as `loopback` is a participant and `loop` alone is refused).
type KindParser = (where: StatementWhere) => StatementParse | null;

const parseParticipant: KindParser = (where) => {
  const match = SEQUENCE_STATEMENT_PATTERNS.participant.exec(where.text);
  if (match === null) return null;
  if (match[1] !== undefined) return refuse("createDestroy");
  const id = tokenOf(where, match, 3);
  if (hasReservedId([id])) return refuse("reservedWordAsId");
  const alias = optionalTokenOf(where, match, 4);
  if (alias !== null && hasWrapPrefix(alias)) return refuse("wrapPrefix");
  const keyword = tokenOf(where, match, 2);
  const declaration = keyword.text.toLowerCase();
  if (
    !(SEQUENCE_PARTICIPANT_KINDS as readonly string[]).includes(declaration)
  ) {
    return refuse("unrecognisedStatement");
  }
  return parsed({
    ...baseOf(where),
    kind: "participant",
    declaration: declaration as SequenceParticipantKind,
    keyword,
    id,
    alias,
  });
};

const parseDestroy: KindParser = (where) =>
  SEQUENCE_STATEMENT_PATTERNS.destroy.test(where.text)
    ? refuse("createDestroy")
    : null;

const parseActivation: KindParser = (where) => {
  const match = SEQUENCE_STATEMENT_PATTERNS.activation.exec(where.text);
  if (match === null) return null;
  const id = tokenOf(where, match, 2);
  if (hasReservedId([id])) return refuse("reservedWordAsId");
  return parsed({
    ...baseOf(where),
    kind: "activation",
    activate: match[1]?.toLowerCase() === "activate",
    id,
  });
};

const parseMessage: KindParser = (where) => {
  const match = SEQUENCE_STATEMENT_PATTERNS.message.exec(where.text);
  if (match === null) return null;
  const from = tokenOf(where, match, 1);
  const to = tokenOf(where, match, 4);
  if (hasReservedId([from, to])) return refuse("reservedWordAsId");
  const messageText = tokenOf(where, match, 5);
  if (hasWrapPrefix(messageText)) return refuse("wrapPrefix");
  const arrow = tokenOf(where, match, 2);
  return parsed({
    ...baseOf(where),
    kind: "message",
    from,
    arrow,
    arrowValue: arrow.text.toLowerCase() as SequenceArrow,
    sign: optionalTokenOf(where, match, 3),
    to,
    messageText,
  });
};

const parseNote: KindParser = (where) => {
  const match = SEQUENCE_STATEMENT_PATTERNS.note.exec(where.text);
  if (match === null) return null;
  const ids = [tokenOf(where, match, 2)];
  const second = optionalTokenOf(where, match, 3);
  if (second !== null) ids.push(second);
  if (hasReservedId(ids)) return refuse("reservedWordAsId");
  const noteText = tokenOf(where, match, 4);
  if (hasWrapPrefix(noteText)) return refuse("wrapPrefix");
  const placementToken = tokenOf(where, match, 1);
  const placement = NOTE_PLACEMENT_BY_WORD.get(
    placementToken.text.toLowerCase(),
  );
  // `Note left of A,B` is not a form Mermaid draws as written; the editor does not read it.
  if (placement === undefined || (placement !== "over" && ids.length > 1)) {
    return refuse("unrecognisedStatement");
  }
  return parsed({
    ...baseOf(where),
    kind: "note",
    placement,
    placementToken,
    ids,
    noteText,
  });
};

const parseBlockStart: KindParser = (where) => {
  const match = SEQUENCE_STATEMENT_PATTERNS.blockStart.exec(where.text);
  if (match === null) return null;
  const keyword = tokenOf(where, match, 1);
  const label = tokenOf(where, match, 2);
  if (hasWrapPrefix(label)) return refuse("wrapPrefix");
  return parsed({
    ...baseOf(where),
    kind: "blockStart",
    block: keyword.text.toLowerCase() as SequenceBlock,
    keyword,
    label,
  });
};

const parseBranch: KindParser = (where) => {
  const match = SEQUENCE_STATEMENT_PATTERNS.branch.exec(where.text);
  if (match === null) return null;
  const keyword = tokenOf(where, match, 1);
  const label = tokenOf(where, match, 2);
  if (hasWrapPrefix(label)) return refuse("wrapPrefix");
  return parsed({
    ...baseOf(where),
    kind: "branch",
    branch: keyword.text.toLowerCase() as SequenceBranch,
    keyword,
    label,
  });
};

const parseBlockEnd: KindParser = (where) =>
  SEQUENCE_STATEMENT_PATTERNS.blockEnd.test(where.text)
    ? parsed({ ...baseOf(where), kind: "blockEnd" })
    : null;

const parseBox: KindParser = (where) =>
  SEQUENCE_STATEMENT_PATTERNS.box.test(where.text)
    ? refuse("boxStatement")
    : null;

const parseAutonumber: KindParser = (where) => {
  if (SEQUENCE_STATEMENT_PATTERNS.autonumberOff.test(where.text)) {
    return parsed({
      ...baseOf(where),
      kind: "autonumber",
      visible: false,
      start: null,
      step: null,
      bare: false,
    });
  }
  const match = SEQUENCE_STATEMENT_PATTERNS.autonumber.exec(where.text);
  if (match === null) return null;
  const start = match[1] === undefined ? null : Number(match[1]);
  const step = match[2] === undefined ? null : Number(match[2]);
  return parsed({
    ...baseOf(where),
    kind: "autonumber",
    visible: true,
    start,
    step: autonumberStep(start, step),
    bare: start === null,
  });
};

const parseTitle: KindParser = (where) => {
  const match =
    SEQUENCE_STATEMENT_PATTERNS.title.exec(where.text) ??
    SEQUENCE_STATEMENT_PATTERNS.titleColon.exec(where.text);
  if (match === null) return null;
  return parsed({
    ...baseOf(where),
    kind: "title",
    title: tokenOf(where, match, 1),
  });
};

const parseLinkLike: KindParser = (where) =>
  SEQUENCE_STATEMENT_PATTERNS.linkLike.test(where.text)
    ? refuse("linkStatement")
    : null;

const parseAccessibility: KindParser = (where) =>
  SEQUENCE_STATEMENT_PATTERNS.accessibility.test(where.text)
    ? refuse("accessibilityStatement")
    : null;

const KIND_PARSERS: readonly KindParser[] = [
  parseParticipant,
  parseDestroy,
  parseActivation,
  parseMessage,
  parseNote,
  parseBlockStart,
  parseBranch,
  parseBlockEnd,
  parseBox,
  parseAutonumber,
  parseTitle,
  parseLinkLike,
  parseAccessibility,
];

export function parseSequenceStatement(where: StatementWhere): StatementParse {
  for (const parseKind of KIND_PARSERS) {
    const result = parseKind(where);
    if (result !== null) return result;
  }
  return refuse("unrecognisedStatement");
}
