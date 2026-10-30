import { type DomainResult, ok } from "../../shared/domain-result";
import type { TextEdit } from "../text-edit";
import {
  type AddBranchOperation,
  type DeleteBranchOperation,
  planAddBranch,
  planDeleteBranch,
  planUnwrapBlock,
  planWrapInBlock,
  type UnwrapBlockOperation,
  type WrapInBlockOperation,
} from "./sequence-block-operations";
import {
  isSequenceArrow,
  SEQUENCE_AUTONUMBER_KEYWORD,
  SEQUENCE_COLOUR_BLOCK,
  SEQUENCE_NOTE_KEYWORD,
  SEQUENCE_NOTE_PLACEMENT_WORDS,
  SEQUENCE_NOTE_PLACEMENTS,
  SEQUENCE_PARTICIPANT_KINDS,
  SEQUENCE_TITLE_KEYWORD,
  type SequenceArrow,
  type SequenceNotePlacement,
  type SequenceParticipantKind,
} from "./sequence-config";
import {
  appendLineEdit,
  indentOfLine,
  insertLineAfterEdit,
  insertLineBeforeEdit,
  insertStatementsBeforeEdit,
  isLastOnLine,
  removeStatementEdits,
  replaceStatementEdit,
  topLevelIndent,
} from "./sequence-edit-lines";
import type {
  SequenceMeaning,
  SequenceMessageItem,
  SequenceNoteItem,
  SequenceParticipantMeaning,
} from "./sequence-meaning";
import {
  withItemInserted,
  withItemRemoved,
  withItemReplaced,
  withItemsSwapped,
  withParticipant,
  withParticipantInserted,
  withTitle,
} from "./sequence-meaning-edit";
import {
  type DuplicateMessageOperation,
  planDuplicateMessage,
  planSetMessageActivation,
  type SetMessageActivationOperation,
} from "./sequence-message-operations";
import {
  SEQUENCE_ALIAS_LEAD,
  SEQUENCE_MESSAGE_COLON,
  SEQUENCE_MESSAGE_TEXT_LEAD,
  SEQUENCE_NOTE_ID_SEPARATOR,
  SEQUENCE_TEXT_LEAD,
  SEQUENCE_UNKNOWN_STATEMENT_INDEX,
  type SequenceTextField,
} from "./sequence-operation-config";
import {
  checkSequenceMeaning,
  declarationText,
  lastItemIndexOf,
  NO_EDITS,
  type Planned,
  type PreparedSequence,
  participantOf,
  participantsCreatedBy,
  planned,
  prepareSequence,
  refuse,
  resolveItem,
  type SequenceItemTarget,
  type SequenceOperationPlan,
} from "./sequence-operation-support";
import {
  type DeleteParticipantOperation,
  planDeleteParticipant,
  planReorderParticipants,
  type ReorderParticipantsOperation,
} from "./sequence-participant-operations";
import { readSequence } from "./sequence-reader";
import {
  encodeSequenceText,
  generateParticipantId,
  validateNewParticipantId,
  writtenTextRestriction,
} from "./sequence-text";
import type { SequenceStatement, SequenceToken } from "./sequence-types";

// Tier 1 operations of the sequence GUI editor ("Tier 1" is the basic set of edits, "Tier 2" the
// later, more structural ones on participants, messages and blocks). Pure
// functions from the current source to a set of TextEdits plus the meaning the result must
// have: "meaning before + what the operation meant". They change only the bytes the
// operation is about (a token, a text, one inserted or removed line), so every other byte
// stays as it was. The caller applies the edits and proves the candidate with
// `verifySequenceCandidate` (the same check every plan also passes before it is handed out:
// when a plan cannot be shown to read back as promised, the operation is refused).

export type SequenceOperation =
  | {
      readonly kind: "addParticipant";
      readonly participantKind: SequenceParticipantKind;
      // Plain text as a person sees it; empty (or equal to the id) writes no alias.
      readonly label: string;
      // Made up (`P1`, `P2` ...) when omitted.
      readonly id?: string;
    }
  | {
      readonly kind: "renameParticipantLabel";
      readonly participantId: string;
      readonly label: string;
    }
  | {
      readonly kind: "changeParticipantKind";
      readonly participantId: string;
      readonly participantKind: SequenceParticipantKind;
    }
  | {
      readonly kind: "addMessage";
      readonly from: string;
      readonly to: string;
      readonly arrow: SequenceArrow;
      readonly text: string;
      // Written right behind this message or note (and so inside the same block); at the
      // end of the diagram when omitted.
      readonly after?: SequenceItemTarget;
    }
  | {
      readonly kind: "editMessageText";
      readonly target: SequenceItemTarget;
      readonly text: string;
    }
  | {
      readonly kind: "changeArrow";
      readonly target: SequenceItemTarget;
      readonly arrow: SequenceArrow;
    }
  | { readonly kind: "deleteMessage"; readonly target: SequenceItemTarget }
  | {
      readonly kind: "moveMessage";
      readonly target: SequenceItemTarget;
      readonly direction: "up" | "down";
    }
  | {
      readonly kind: "addNote";
      readonly placement: SequenceNotePlacement;
      // One participant, or one or two for `over`.
      readonly participants: readonly string[];
      readonly text: string;
      readonly after?: SequenceItemTarget;
    }
  | {
      readonly kind: "editNoteText";
      readonly target: SequenceItemTarget;
      readonly text: string;
    }
  | {
      readonly kind: "changeNotePlacement";
      readonly target: SequenceItemTarget;
      readonly placement: SequenceNotePlacement;
    }
  | { readonly kind: "deleteNote"; readonly target: SequenceItemTarget }
  | {
      readonly kind: "editBlockText";
      readonly target: SequenceItemTarget;
      readonly text: string;
    }
  | { readonly kind: "setAutonumber"; readonly enabled: boolean }
  | {
      readonly kind: "setTitle";
      // Empty removes the title.
      readonly title: string;
    }
  // Tier 2.
  | DeleteParticipantOperation
  | ReorderParticipantsOperation
  | WrapInBlockOperation
  | UnwrapBlockOperation
  | AddBranchOperation
  | DeleteBranchOperation
  | SetMessageActivationOperation
  | DuplicateMessageOperation;

export type { SequenceOperationPlan };

// A text token is replaced by the encoded text; a token that is empty (`loop`, `else`, an
// empty message) has no text to replace, so the new text goes there with a blank in front.
function textTokenEdit(token: SequenceToken, encoded: string): TextEdit {
  if (token.text === "") {
    return {
      start: token.span.start,
      end: token.span.end,
      text: encoded === "" ? "" : `${SEQUENCE_TEXT_LEAD}${encoded}`,
    };
  }
  return { start: token.span.start, end: token.span.end, text: encoded };
}

function entityRestriction(written: string): Planned | null {
  const restriction = writtenTextRestriction(written);
  return restriction === null
    ? null
    : refuse(
        restriction,
        "the written text holds entity-like text that Mermaid decodes when it draws",
      );
}

function participantStatement(
  prepared: PreparedSequence,
  participantId: string,
): Extract<SequenceStatement, { kind: "participant" }> | undefined {
  return prepared.reading.statements.find(
    (
      statement,
    ): statement is Extract<SequenceStatement, { kind: "participant" }> =>
      statement.kind === "participant" && statement.id.text === participantId,
  );
}

function findParticipant(
  prepared: PreparedSequence,
  participantId: string,
): DomainResult<SequenceParticipantMeaning> {
  const found = participantOf(prepared.meaning, participantId);
  return found === undefined
    ? refuse("participantNotFound", `no participant ${participantId}`)
    : ok(found);
}

// ---------------------------------------------------------------------------------------
// Participants

function planAddParticipant(
  source: string,
  prepared: PreparedSequence,
  operation: Extract<SequenceOperation, { kind: "addParticipant" }>,
): Planned {
  const { reading, meaning } = prepared;
  if (!SEQUENCE_PARTICIPANT_KINDS.includes(operation.participantKind)) {
    return refuse("invalidKind", `unknown kind ${operation.participantKind}`);
  }
  const taken = new Set(
    meaning.participants.map((participant) => participant.id),
  );
  let id: string;
  if (operation.id === undefined) {
    id = generateParticipantId(taken);
  } else {
    const valid = validateNewParticipantId(operation.id, taken);
    if (!valid.ok) return valid;
    id = operation.id;
  }
  const label = operation.label.trim();
  let alias: string | null = null;
  if (label !== "") {
    const encoded = encodeSequenceText(label, "alias");
    if (!encoded.ok) return encoded;
    if (encoded.value !== id) alias = encoded.value;
  }
  const text = declarationText(operation.participantKind, id, alias);
  // Where the declaration goes decides where the column is: behind the last declaration (or in
  // front of the first statement when nothing is declared), so no existing column moves.
  const lastDeclaration = [...reading.statements]
    .reverse()
    .find((statement) => statement.kind === "participant");
  const first = reading.statements[0];
  let edit: TextEdit;
  let position: number;
  if (lastDeclaration !== undefined) {
    const indent = indentOfLine(reading, lastDeclaration.lineIndex);
    edit = insertLineAfterEdit(
      reading,
      lastDeclaration.lineIndex,
      `${indent}${text}`,
    );
    position = meaning.participants.filter(
      (participant) =>
        (reading.statements[participant.firstMention.statementIndex]
          ?.lineIndex ?? 0) <= lastDeclaration.lineIndex,
    ).length;
  } else if (first !== undefined) {
    const indent = indentOfLine(reading, first.lineIndex);
    edit = insertLineBeforeEdit(reading, first.lineIndex, `${indent}${text}`);
    position = 0;
  } else {
    edit = appendLineEdit(reading, `${topLevelIndent(reading)}${text}`);
    position = 0;
  }
  const expected = withParticipantInserted(meaning, position, {
    id,
    label: alias ?? id,
    kind: operation.participantKind,
    declared: true,
    firstMention: { statementIndex: SEQUENCE_UNKNOWN_STATEMENT_INDEX },
  });
  return planned(source, [edit], expected);
}

// The participants an implicit participant has to be declared with so that the declaration
// can stand where the statement is: every participant that statement creates up to and
// including this one, in the order Mermaid adds them (declaring only this one would move it
// in front of the others).
function declarationsForImplicit(
  prepared: PreparedSequence,
  participant: SequenceParticipantMeaning,
  declaration: string,
): {
  readonly statement: SequenceStatement;
  readonly texts: readonly string[];
} | null {
  const statement =
    prepared.reading.statements[participant.firstMention.statementIndex];
  if (statement === undefined) return null;
  const created = participantsCreatedBy(prepared.meaning, statement.index);
  const through = created.findIndex((entry) => entry.id === participant.id);
  if (through === -1) return null;
  return {
    statement,
    texts: created
      .slice(0, through + 1)
      .map((entry) =>
        entry.id === participant.id
          ? declaration
          : declarationText("participant", entry.id, null),
      ),
  };
}

function planRenameParticipantLabel(
  source: string,
  prepared: PreparedSequence,
  operation: Extract<SequenceOperation, { kind: "renameParticipantLabel" }>,
): Planned {
  const found = findParticipant(prepared, operation.participantId);
  if (!found.ok) return found;
  const participant = found.value;
  const encoded = encodeSequenceText(operation.label, "alias");
  if (!encoded.ok) return encoded;
  if (encoded.value === "") {
    return refuse("emptyLabel", "a participant needs a label");
  }
  const expected = withParticipant(prepared.meaning, participant.id, {
    label: encoded.value,
    declared: true,
  });
  if (encoded.value === participant.label) {
    return ok({ edits: NO_EDITS, expected: prepared.meaning });
  }
  const restricted = entityRestriction(participant.label);
  if (restricted !== null) return restricted;
  if (participant.declared) {
    const statement = participantStatement(prepared, participant.id);
    if (statement === undefined) {
      return refuse(
        "declarationNotFound",
        `${participant.id} has no declaration`,
      );
    }
    const edit: TextEdit =
      statement.alias === null
        ? {
            start: statement.span.end,
            end: statement.span.end,
            text: `${SEQUENCE_ALIAS_LEAD}${encoded.value}`,
          }
        : {
            start: statement.alias.span.start,
            end: statement.alias.span.end,
            text: encoded.value,
          };
    return planned(source, [edit], expected);
  }
  const declarations = declarationsForImplicit(
    prepared,
    participant,
    declarationText(participant.kind, participant.id, encoded.value),
  );
  if (declarations === null) {
    return refuse("firstMentionNotFound", `${participant.id} is not written`);
  }
  return planned(
    source,
    [
      insertStatementsBeforeEdit(
        prepared.reading,
        declarations.statement,
        declarations.texts,
      ),
    ],
    expected,
  );
}

function planChangeParticipantKind(
  source: string,
  prepared: PreparedSequence,
  operation: Extract<SequenceOperation, { kind: "changeParticipantKind" }>,
): Planned {
  if (!SEQUENCE_PARTICIPANT_KINDS.includes(operation.participantKind)) {
    return refuse("invalidKind", `unknown kind ${operation.participantKind}`);
  }
  const found = findParticipant(prepared, operation.participantId);
  if (!found.ok) return found;
  const participant = found.value;
  if (participant.kind === operation.participantKind) {
    return ok({ edits: NO_EDITS, expected: prepared.meaning });
  }
  const expected = withParticipant(prepared.meaning, participant.id, {
    kind: operation.participantKind,
    declared: true,
  });
  if (participant.declared) {
    const statement = participantStatement(prepared, participant.id);
    if (statement === undefined) {
      return refuse(
        "declarationNotFound",
        `${participant.id} has no declaration`,
      );
    }
    return planned(
      source,
      [{ ...statement.keyword.span, text: operation.participantKind }],
      expected,
    );
  }
  const declarations = declarationsForImplicit(
    prepared,
    participant,
    declarationText(operation.participantKind, participant.id, null),
  );
  if (declarations === null) {
    return refuse("firstMentionNotFound", `${participant.id} is not written`);
  }
  return planned(
    source,
    [
      insertStatementsBeforeEdit(
        prepared.reading,
        declarations.statement,
        declarations.texts,
      ),
    ],
    expected,
  );
}

// ---------------------------------------------------------------------------------------
// New messages and notes

interface Insertion {
  readonly edit: (content: string) => TextEdit;
  readonly indent: string;
  // Where the new entry goes in the item list.
  readonly itemIndex: number;
}

// Where a new line goes: at the end of the diagram, or right behind a message or note. A new
// line may only name participants that exist by then: one that is first mentioned later would
// move to this line and change the order of the columns.
function planInsertion(
  prepared: PreparedSequence,
  after: SequenceItemTarget | undefined,
  participants: readonly string[],
): DomainResult<Insertion> {
  const { reading, meaning } = prepared;
  const known = new Map(
    meaning.participants.map((participant) => [participant.id, participant]),
  );
  for (const id of participants) {
    if (!known.has(id)) {
      return refuse(
        "participantNotFound",
        `${id} is not a participant of the diagram (a new one would be created at this line)`,
      );
    }
  }
  if (after === undefined) {
    const indent = topLevelIndent(reading);
    return ok({
      indent,
      edit: (content) => appendLineEdit(reading, content),
      itemIndex: meaning.items.length,
    });
  }
  const resolved = resolveItem(prepared, after, ["message", "note"]);
  if (!resolved.ok) return resolved;
  const { statement } = resolved.value;
  if (!isLastOnLine(reading, statement)) {
    return refuse(
      "sharedLine",
      "the statement is followed by another one on its line",
    );
  }
  for (const id of participants) {
    const participant = known.get(id);
    if (
      participant !== undefined &&
      participant.firstMention.statementIndex > statement.index
    ) {
      return refuse(
        "participantCreatedLater",
        `${id} first appears further down, so a line here would move its column`,
      );
    }
  }
  return ok({
    indent: indentOfLine(reading, statement.lineIndex),
    edit: (content) =>
      insertLineAfterEdit(reading, statement.lineIndex, content),
    itemIndex: lastItemIndexOf(meaning, statement.index) + 1,
  });
}

function planAddMessage(
  source: string,
  prepared: PreparedSequence,
  operation: Extract<SequenceOperation, { kind: "addMessage" }>,
): Planned {
  if (!isSequenceArrow(operation.arrow)) {
    return refuse("invalidArrow", `unknown arrow ${operation.arrow}`);
  }
  const encoded = encodeSequenceText(operation.text, "message");
  if (!encoded.ok) return encoded;
  const insertion = planInsertion(prepared, operation.after, [
    operation.from,
    operation.to,
  ]);
  if (!insertion.ok) return insertion;
  const line = `${operation.from}${operation.arrow}${operation.to}${
    encoded.value === ""
      ? SEQUENCE_MESSAGE_COLON
      : `${SEQUENCE_MESSAGE_TEXT_LEAD}${encoded.value}`
  }`;
  const item: SequenceMessageItem = {
    kind: "message",
    statementIndex: SEQUENCE_UNKNOWN_STATEMENT_INDEX,
    from: operation.from,
    to: operation.to,
    arrow: operation.arrow,
    text: encoded.value,
    activates: false,
  };
  return planned(
    source,
    [insertion.value.edit(`${insertion.value.indent}${line}`)],
    withItemInserted(prepared.meaning, insertion.value.itemIndex, item),
  );
}

function planAddNote(
  source: string,
  prepared: PreparedSequence,
  operation: Extract<SequenceOperation, { kind: "addNote" }>,
): Planned {
  if (!SEQUENCE_NOTE_PLACEMENTS.includes(operation.placement)) {
    return refuse(
      "invalidPlacement",
      `unknown placement ${operation.placement}`,
    );
  }
  const limit = operation.placement === "over" ? 2 : 1;
  if (
    operation.participants.length < 1 ||
    operation.participants.length > limit ||
    new Set(operation.participants).size !== operation.participants.length
  ) {
    return refuse(
      "noteParticipants",
      `a note ${SEQUENCE_NOTE_PLACEMENT_WORDS[operation.placement]} takes ${limit === 1 ? "one participant" : "one or two different participants"}`,
    );
  }
  const encoded = encodeSequenceText(operation.text, "note");
  if (!encoded.ok) return encoded;
  const insertion = planInsertion(
    prepared,
    operation.after,
    operation.participants,
  );
  if (!insertion.ok) return insertion;
  const line = `${SEQUENCE_NOTE_KEYWORD} ${SEQUENCE_NOTE_PLACEMENT_WORDS[operation.placement]} ${operation.participants.join(SEQUENCE_NOTE_ID_SEPARATOR)}${
    encoded.value === ""
      ? SEQUENCE_MESSAGE_COLON
      : `${SEQUENCE_MESSAGE_TEXT_LEAD}${encoded.value}`
  }`;
  const item: SequenceNoteItem = {
    kind: "note",
    statementIndex: SEQUENCE_UNKNOWN_STATEMENT_INDEX,
    placement: operation.placement,
    participants: operation.participants,
    text: encoded.value,
  };
  return planned(
    source,
    [insertion.value.edit(`${insertion.value.indent}${line}`)],
    withItemInserted(prepared.meaning, insertion.value.itemIndex, item),
  );
}

// ---------------------------------------------------------------------------------------
// Editing what is written

function planEditText(
  source: string,
  prepared: PreparedSequence,
  target: SequenceItemTarget,
  text: string,
): Planned {
  const resolved = resolveItem(prepared, target, [
    "message",
    "note",
    "blockStart",
    "branch",
  ]);
  if (!resolved.ok) return resolved;
  const { index, item, statement } = resolved.value;
  if (
    item.kind !== "message" &&
    item.kind !== "note" &&
    item.kind !== "blockStart" &&
    item.kind !== "branch"
  ) {
    return refuse("wrongTargetKind", "this entry has no text");
  }
  let field: SequenceTextField = "blockLabel";
  let token: SequenceToken;
  switch (statement.kind) {
    case "message":
      field = "message";
      token = statement.messageText;
      break;
    case "note":
      field = "note";
      token = statement.noteText;
      break;
    case "blockStart":
      if (statement.block === SEQUENCE_COLOUR_BLOCK) {
        return refuse(
          "colourBlock",
          "the text of a rect is a colour, which the editor does not rewrite",
        );
      }
      token = statement.label;
      break;
    case "branch":
      token = statement.label;
      break;
    default:
      return refuse("wrongTargetKind", "this entry has no text");
  }
  const encoded = encodeSequenceText(text, field);
  if (!encoded.ok) return encoded;
  if (encoded.value === token.text) {
    return ok({ edits: NO_EDITS, expected: prepared.meaning });
  }
  const restricted = entityRestriction(token.text);
  if (restricted !== null) return restricted;
  return planned(
    source,
    [textTokenEdit(token, encoded.value)],
    withItemReplaced(prepared.meaning, index, { ...item, text: encoded.value }),
  );
}

function planChangeArrow(
  source: string,
  prepared: PreparedSequence,
  target: SequenceItemTarget,
  arrow: SequenceArrow,
): Planned {
  if (!isSequenceArrow(arrow)) {
    return refuse("invalidArrow", `unknown arrow ${arrow}`);
  }
  const resolved = resolveItem(prepared, target, ["message"]);
  if (!resolved.ok) return resolved;
  const { index, item, statement } = resolved.value;
  if (item.kind !== "message")
    return refuse("wrongTargetKind", "not a message");
  if (item.arrow === arrow && statement.arrow.text === arrow) {
    return ok({ edits: NO_EDITS, expected: prepared.meaning });
  }
  return planned(
    source,
    [{ ...statement.arrow.span, text: arrow }],
    withItemReplaced(prepared.meaning, index, { ...item, arrow }),
  );
}

// A statement that is removed may be the first mention of a participant; Mermaid then drops
// the participant, or moves it when a later statement mentions it. The statement is written
// as declarations of those participants instead, in the order they had.
function planRemoval(
  source: string,
  prepared: PreparedSequence,
  statement: SequenceStatement,
  index: number,
): Planned {
  const created = participantsCreatedBy(prepared.meaning, statement.index);
  const edits =
    created.length === 0
      ? removeStatementEdits(prepared.reading, statement)
      : [
          replaceStatementEdit(
            prepared.reading,
            statement,
            created.map((participant) =>
              declarationText("participant", participant.id, null),
            ),
          ),
        ];
  return planned(source, edits, withItemRemoved(prepared.meaning, index));
}

function planDeleteMessage(
  source: string,
  prepared: PreparedSequence,
  target: SequenceItemTarget,
): Planned {
  const resolved = resolveItem(prepared, target, ["message"]);
  if (!resolved.ok) return resolved;
  const { index, statement } = resolved.value;
  if (statement.sign !== null) {
    return refuse(
      "activationSign",
      "the message carries + or -, which pairs it with another message",
    );
  }
  return planRemoval(source, prepared, statement, index);
}

function planDeleteNote(
  source: string,
  prepared: PreparedSequence,
  target: SequenceItemTarget,
): Planned {
  const resolved = resolveItem(prepared, target, ["note"]);
  if (!resolved.ok) return resolved;
  return planRemoval(
    source,
    prepared,
    resolved.value.statement,
    resolved.value.index,
  );
}

function planMoveMessage(
  source: string,
  prepared: PreparedSequence,
  target: SequenceItemTarget,
  direction: "up" | "down",
): Planned {
  const resolved = resolveItem(prepared, target, ["message"]);
  if (!resolved.ok) return resolved;
  const { statement } = resolved.value;
  const { reading, meaning } = prepared;
  const neighbour =
    reading.statements[statement.index + (direction === "up" ? -1 : 1)];
  if (neighbour === undefined) {
    return refuse("atBoundary", "there is no statement on that side");
  }
  if (neighbour.kind !== "message" && neighbour.kind !== "note") {
    return refuse(
      "blockBoundary",
      `the neighbour is a ${neighbour.kind}; moving across it would change the block structure`,
    );
  }
  if (
    statement.sign !== null ||
    (neighbour.kind === "message" && neighbour.sign !== null)
  ) {
    return refuse(
      "activationSign",
      "a message with + or - is paired with another message",
    );
  }
  const first = direction === "up" ? neighbour : statement;
  const second = direction === "up" ? statement : neighbour;
  const created = [
    ...participantsCreatedBy(meaning, first.index),
    ...participantsCreatedBy(meaning, second.index),
  ];
  const edits: TextEdit[] = [
    { ...first.span, text: second.text },
    { ...second.span, text: first.text },
  ];
  if (created.length > 0) {
    edits.push(
      insertStatementsBeforeEdit(
        reading,
        first,
        created.map((participant) =>
          declarationText("participant", participant.id, null),
        ),
      ),
    );
  }
  const firstIndex = meaning.items.findIndex(
    (item) => item.statementIndex === first.index,
  );
  const secondIndex = meaning.items.findIndex(
    (item) => item.statementIndex === second.index,
  );
  return planned(
    source,
    edits,
    withItemsSwapped(meaning, firstIndex, secondIndex),
  );
}

function planChangeNotePlacement(
  source: string,
  prepared: PreparedSequence,
  target: SequenceItemTarget,
  placement: SequenceNotePlacement,
): Planned {
  if (!SEQUENCE_NOTE_PLACEMENTS.includes(placement)) {
    return refuse("invalidPlacement", `unknown placement ${placement}`);
  }
  const resolved = resolveItem(prepared, target, ["note"]);
  if (!resolved.ok) return resolved;
  const { index, item, statement } = resolved.value;
  if (item.kind !== "note") return refuse("wrongTargetKind", "not a note");
  if (item.placement === placement) {
    return ok({ edits: NO_EDITS, expected: prepared.meaning });
  }
  const word = SEQUENCE_NOTE_PLACEMENT_WORDS[placement];
  const [firstId, secondId] = statement.ids;
  if (firstId === undefined)
    return refuse("targetNotFound", "the note has no participant");
  if (placement === "over" || secondId === undefined) {
    return planned(
      source,
      [{ ...statement.placementToken.span, text: word }],
      withItemReplaced(prepared.meaning, index, { ...item, placement }),
    );
  }
  // `left of` and `right of` take one participant: the second one is dropped, which is only
  // safe when it exists anyway (this note is not what creates it).
  const dropped = participantOf(prepared.meaning, secondId.text);
  if (
    secondId.text !== firstId.text &&
    (dropped === undefined ||
      dropped.firstMention.statementIndex >= statement.index)
  ) {
    return refuse(
      "dropsParticipant",
      `${secondId.text} first appears in this note, so dropping it would remove the participant`,
    );
  }
  return planned(
    source,
    [
      {
        start: statement.placementToken.span.start,
        end: secondId.span.end,
        text: `${word} ${firstId.text}`,
      },
    ],
    withItemReplaced(prepared.meaning, index, {
      ...item,
      placement,
      participants: [firstId.text],
    }),
  );
}

// ---------------------------------------------------------------------------------------
// Autonumber and title

function planSetAutonumber(
  source: string,
  prepared: PreparedSequence,
  enabled: boolean,
): Planned {
  const { reading, meaning } = prepared;
  const statements = reading.statements.filter(
    (statement) => statement.kind === "autonumber",
  );
  const [only] = statements;
  if (statements.length > 1 || (only !== undefined && !only.bare)) {
    return refuse(
      "autonumberNotBare",
      "the diagram has an autonumber with arguments, an autonumber off, or several autonumber lines",
    );
  }
  if (enabled === (only !== undefined)) {
    return ok({ edits: NO_EDITS, expected: meaning });
  }
  if (only !== undefined) {
    const index = meaning.items.findIndex(
      (item) => item.statementIndex === only.index,
    );
    return planned(
      source,
      removeStatementEdits(reading, only),
      withItemRemoved(meaning, index),
    );
  }
  if (reading.headerLineIndex === null) {
    return refuse("noHeader", "the diagram has no header line");
  }
  return planned(
    source,
    [
      insertLineAfterEdit(
        reading,
        reading.headerLineIndex,
        `${topLevelIndent(reading)}${SEQUENCE_AUTONUMBER_KEYWORD}`,
      ),
    ],
    withItemInserted(meaning, 0, {
      kind: "autonumber",
      statementIndex: SEQUENCE_UNKNOWN_STATEMENT_INDEX,
      visible: true,
      start: null,
      step: null,
    }),
  );
}

function planSetTitle(
  source: string,
  prepared: PreparedSequence,
  title: string,
): Planned {
  const { reading, meaning } = prepared;
  const titles = reading.statements.filter(
    (statement) => statement.kind === "title",
  );
  if (titles.length > 1) {
    return refuse("multipleTitles", "the diagram has several title lines");
  }
  const [existing] = titles;
  if (title.trim() === "") {
    if (existing === undefined)
      return ok({ edits: NO_EDITS, expected: meaning });
    return planned(
      source,
      removeStatementEdits(reading, existing),
      withTitle(meaning, ""),
    );
  }
  const encoded = encodeSequenceText(title, "title");
  if (!encoded.ok) return encoded;
  if (existing !== undefined) {
    if (existing.title.text === encoded.value) {
      return ok({ edits: NO_EDITS, expected: meaning });
    }
    const restricted = entityRestriction(existing.title.text);
    if (restricted !== null) return restricted;
    return planned(
      source,
      [{ ...existing.title.span, text: encoded.value }],
      withTitle(meaning, encoded.value),
    );
  }
  if (reading.headerLineIndex === null) {
    return refuse("noHeader", "the diagram has no header line");
  }
  return planned(
    source,
    [
      insertLineAfterEdit(
        reading,
        reading.headerLineIndex,
        `${topLevelIndent(reading)}${SEQUENCE_TITLE_KEYWORD} ${encoded.value}`,
      ),
    ],
    withTitle(meaning, encoded.value),
  );
}

// ---------------------------------------------------------------------------------------

export function planSequenceOperation(
  source: string,
  operation: SequenceOperation,
): Planned {
  const prepared = prepareSequence(source);
  if (!prepared.ok) return prepared;
  const state = prepared.value;
  switch (operation.kind) {
    case "addParticipant":
      return planAddParticipant(source, state, operation);
    case "renameParticipantLabel":
      return planRenameParticipantLabel(source, state, operation);
    case "changeParticipantKind":
      return planChangeParticipantKind(source, state, operation);
    case "addMessage":
      return planAddMessage(source, state, operation);
    case "editMessageText":
    case "editNoteText":
    case "editBlockText":
      return planEditText(source, state, operation.target, operation.text);
    case "changeArrow":
      return planChangeArrow(source, state, operation.target, operation.arrow);
    case "deleteMessage":
      return planDeleteMessage(source, state, operation.target);
    case "moveMessage":
      return planMoveMessage(
        source,
        state,
        operation.target,
        operation.direction,
      );
    case "addNote":
      return planAddNote(source, state, operation);
    case "changeNotePlacement":
      return planChangeNotePlacement(
        source,
        state,
        operation.target,
        operation.placement,
      );
    case "deleteNote":
      return planDeleteNote(source, state, operation.target);
    case "setAutonumber":
      return planSetAutonumber(source, state, operation.enabled);
    case "setTitle":
      return planSetTitle(source, state, operation.title);
    case "deleteParticipant":
      return planDeleteParticipant(source, state, operation);
    case "reorderParticipants":
      return planReorderParticipants(source, state, operation);
    case "wrapInBlock":
      return planWrapInBlock(source, state, operation);
    case "unwrapBlock":
      return planUnwrapBlock(source, state, operation);
    case "addBranch":
      return planAddBranch(source, state, operation);
    case "deleteBranch":
      return planDeleteBranch(source, state, operation);
    case "setMessageActivation":
      return planSetMessageActivation(source, state, operation);
    case "duplicateMessage":
      return planDuplicateMessage(source, state, operation);
  }
}

// Proves the text the edits produce: it must read as an editable sequence diagram with
// exactly the meaning the operation promised.
export function verifySequenceCandidate(
  candidateSource: string,
  expected: SequenceMeaning,
): DomainResult<void> {
  return checkSequenceMeaning(readSequence(candidateSource), expected);
}
