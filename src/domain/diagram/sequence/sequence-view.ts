import type {
  SequenceArrow,
  SequenceBlock,
  SequenceBranch,
  SequenceNotePlacement,
  SequenceParticipantKind,
} from "./sequence-config";
import { SEQUENCE_COLOUR_BLOCK } from "./sequence-config";
import type { SequenceActivationSign } from "./sequence-message-operations";
import {
  prepareSequence,
  type SequenceItemTarget,
  targetOfItem,
} from "./sequence-operation-support";
import {
  planSequenceOperation,
  type SequenceOperation,
} from "./sequence-operations";
import { branchKeywordOf } from "./sequence-structure";
import { decodeSequenceText, writtenTextRestriction } from "./sequence-text";
import type { SequenceStatement } from "./sequence-types";

// What the sequence GUI shows of an editable sequence diagram. Read-only and derived from the
// source on every call, so the GUI never holds a model of its own that could drift from the
// text (the same rule as FlowchartView and PieChartView).
//
// `restriction` fields say why a control is unavailable: the first word of the refusal the
// operation would give, found by planning the operation (nothing is applied). The GUI shows
// the control as unavailable with that reason instead of letting the user try.

export interface SequenceParticipantView {
  readonly id: string;
  // What a person reads and edits (entities shown as the characters they stand for). The id
  // itself for a participant that never got an alias.
  readonly displayLabel: string;
  readonly kind: SequenceParticipantKind;
  readonly restriction: string | null;
  // Tier 2: why the participant cannot be deleted / moved a column, or null.
  readonly deleteRestriction: string | null;
  readonly moveLeftRestriction: string | null;
  readonly moveRightRestriction: string | null;
}

// Tier 2: the sign choices of a message and why a choice is unavailable (null = available).
export type SequenceActivationChoice = "+" | "-" | "none";
export type SequenceActivationRestrictions = Readonly<
  Record<SequenceActivationChoice, string | null>
>;

// What a range of entries to wrap can end with: the entry itself and the entries behind it
// that stand at its level of the same branch (a block header stands for the whole block).
interface WrappableBase extends EntryBase {
  readonly wrapEnds: readonly SequenceItemTarget[];
  // Why wrapping this entry alone (the shortest range) is not possible, or null.
  readonly wrapRestriction: string | null;
}

interface EntryBase {
  // The target sent back to the operations (position in the item list and what it holds).
  readonly target: SequenceItemTarget;
  // How many blocks the entry is inside of (a block header and its `end` are at the depth
  // of the block's surroundings).
  readonly depth: number;
}

export interface SequenceMessageEntry extends WrappableBase {
  readonly kind: "message";
  readonly from: string;
  readonly to: string;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly arrow: SequenceArrow;
  readonly displayText: string;
  // `+` (activates the receiver), `-` (deactivates the sender) or null.
  readonly activation: "+" | "-" | null;
  // Why the text cannot be edited, or null.
  readonly textRestriction: string | null;
  readonly deleteRestriction: string | null;
  readonly moveUpRestriction: string | null;
  readonly moveDownRestriction: string | null;
  readonly activationRestrictions: SequenceActivationRestrictions;
  readonly duplicateRestriction: string | null;
}

export interface SequenceNoteEntry extends WrappableBase {
  readonly kind: "note";
  readonly placement: SequenceNotePlacement;
  readonly participants: readonly string[];
  readonly participantLabels: readonly string[];
  readonly displayText: string;
  readonly textRestriction: string | null;
  // Why the placement cannot change to the given one (per placement).
  readonly placementRestrictions: Readonly<
    Record<SequenceNotePlacement, string | null>
  >;
  readonly deleteRestriction: string | null;
}

export interface SequenceBlockStartEntry extends WrappableBase {
  readonly kind: "blockStart";
  readonly block: SequenceBlock;
  readonly displayText: string;
  readonly textRestriction: string | null;
  readonly unwrapRestriction: string | null;
  // The branch keyword the block takes (`else` ...), null for a block without branches.
  readonly branchKeyword: SequenceBranch | null;
  readonly addBranchRestriction: string | null;
}

export interface SequenceBranchEntry extends EntryBase {
  readonly kind: "branch";
  readonly block: SequenceBranch;
  readonly displayText: string;
  readonly textRestriction: string | null;
  readonly deleteRestriction: string | null;
}

export type SequenceBlockEntry = SequenceBlockStartEntry | SequenceBranchEntry;

export interface SequenceBlockEndEntry extends EntryBase {
  readonly kind: "blockEnd";
  readonly block: SequenceBlock;
}

export type SequenceEntryView =
  | SequenceMessageEntry
  | SequenceNoteEntry
  | SequenceBlockEntry
  | SequenceBlockEndEntry;

export type SequenceAutonumberView =
  // No autonumber statement.
  | { readonly state: "off"; readonly restriction: null }
  // A bare `autonumber` the GUI can switch off.
  | { readonly state: "on"; readonly restriction: null }
  // Something else the GUI leaves alone (a start / step, `off`, several lines).
  | { readonly state: "custom"; readonly restriction: string };

export interface SequenceView {
  readonly title: string;
  readonly titleRestriction: string | null;
  readonly autonumber: SequenceAutonumberView;
  readonly participants: readonly SequenceParticipantView[];
  readonly entries: readonly SequenceEntryView[];
}

const MESSAGE_FIELD = "message";
const NOTE_FIELD = "note";
const BLOCK_FIELD = "blockLabel";
const TITLE_FIELD = "title";
const LABEL_FIELD = "alias";
const PLACEHOLDER_TEXT = "x";
const PLACEHOLDER_WRAP_BLOCK = "loop";
const ACTIVATION_SIGN_OF_CHOICE: Readonly<
  Record<SequenceActivationChoice, SequenceActivationSign>
> = { "+": "+", "-": "-", none: null };

// The first word of the reason a plan is refused with, or null when it is planned.
function refusalOf(
  source: string,
  operation: SequenceOperation,
): string | null {
  const plan = planSequenceOperation(source, operation);
  if (plan.ok) return null;
  return plan.error.detail.split(":")[0]?.trim() ?? null;
}

// Null when the text can be edited; the restriction a written text carries otherwise.
function textRestriction(written: string): string | null {
  return writtenTextRestriction(written);
}

// Statements a wrapped range may hold (the same set the operation accepts).
const WRAPPABLE_KINDS: ReadonlySet<SequenceStatement["kind"]> = new Set([
  "message",
  "note",
  "activation",
  "blockStart",
  "branch",
  "blockEnd",
]);

// The entries a range that starts at `statement` may end with: the entry itself, then every
// message, note or block that follows at the same level of the same branch. The operation
// itself decides again when it is asked; this only offers sensible ends.
function wrapEndStatements(
  statements: readonly SequenceStatement[],
  start: SequenceStatement,
): readonly SequenceStatement[] {
  const ends: SequenceStatement[] = [];
  let level = 0;
  for (let index = start.index; index < statements.length; index += 1) {
    const statement = statements[index];
    if (statement === undefined || !WRAPPABLE_KINDS.has(statement.kind)) break;
    if (statement.kind === "blockStart") {
      if (level === 0) ends.push(statement);
      level += 1;
    } else if (statement.kind === "blockEnd") {
      level -= 1;
      if (level < 0) break;
    } else if (statement.kind === "branch") {
      if (level === 0) break;
    } else if (statement.kind !== "activation" && level === 0) {
      ends.push(statement);
    }
  }
  return ends;
}

// Null when the source is not an editable sequence diagram (the GUI shows the reason).
export function readSequenceView(source: string): SequenceView | null {
  const prepared = prepareSequence(source);
  if (!prepared.ok) return null;
  const { reading, meaning } = prepared.value;
  const labelOf = new Map(
    meaning.participants.map((participant) => [
      participant.id,
      decodeSequenceText(participant.label, LABEL_FIELD),
    ]),
  );
  const labelFor = (id: string): string => labelOf.get(id) ?? id;
  const firstItemOf = (statementIndex: number): SequenceItemTarget | null => {
    const position = meaning.items.findIndex(
      (candidate) => candidate.statementIndex === statementIndex,
    );
    const found = meaning.items[position];
    return found === undefined ? null : targetOfItem(position, found);
  };
  const wrapOf = (
    statement: SequenceStatement | undefined,
    target: SequenceItemTarget,
  ): {
    wrapEnds: readonly SequenceItemTarget[];
    wrapRestriction: string | null;
  } => {
    if (statement === undefined) return { wrapEnds: [], wrapRestriction: null };
    const wrapEnds = wrapEndStatements(reading.statements, statement).flatMap(
      (end) => {
        // A block header ends a range with its whole block.
        const endTarget = firstItemOf(end.index);
        return endTarget === null ? [] : [endTarget];
      },
    );
    return {
      wrapEnds,
      wrapRestriction: refusalOf(source, {
        kind: "wrapInBlock",
        from: target,
        to: target,
        block: PLACEHOLDER_WRAP_BLOCK,
        text: PLACEHOLDER_TEXT,
      }),
    };
  };

  const activationRefusal = (
    target: SequenceItemTarget,
    choice: SequenceActivationChoice,
  ): string | null =>
    refusalOf(source, {
      kind: "setMessageActivation",
      target,
      sign: ACTIVATION_SIGN_OF_CHOICE[choice],
    });
  const entries: SequenceEntryView[] = [];
  let depth = 0;
  meaning.items.forEach((item, index) => {
    const target = targetOfItem(index, item);
    const statement = reading.statements.find(
      (candidate) => candidate.index === item.statementIndex,
    );
    switch (item.kind) {
      case "message": {
        const sign =
          statement?.kind === "message" ? (statement.sign?.text ?? null) : null;
        entries.push({
          kind: "message",
          target,
          depth,
          from: item.from,
          to: item.to,
          fromLabel: labelFor(item.from),
          toLabel: labelFor(item.to),
          arrow: item.arrow,
          displayText: decodeSequenceText(item.text, MESSAGE_FIELD),
          activation: sign === "+" || sign === "-" ? sign : null,
          textRestriction: textRestriction(item.text),
          ...wrapOf(statement, target),
          activationRestrictions: {
            "+": activationRefusal(target, "+"),
            "-": activationRefusal(target, "-"),
            none: activationRefusal(target, "none"),
          },
          duplicateRestriction: refusalOf(source, {
            kind: "duplicateMessage",
            target,
          }),
          deleteRestriction: refusalOf(source, {
            kind: "deleteMessage",
            target,
          }),
          moveUpRestriction: refusalOf(source, {
            kind: "moveMessage",
            target,
            direction: "up",
          }),
          moveDownRestriction: refusalOf(source, {
            kind: "moveMessage",
            target,
            direction: "down",
          }),
        });
        break;
      }
      case "note":
        entries.push({
          kind: "note",
          target,
          depth,
          ...wrapOf(statement, target),
          placement: item.placement,
          participants: item.participants,
          participantLabels: item.participants.map(labelFor),
          displayText: decodeSequenceText(item.text, NOTE_FIELD),
          textRestriction: textRestriction(item.text),
          placementRestrictions: {
            leftOf: refusalOf(source, {
              kind: "changeNotePlacement",
              target,
              placement: "leftOf",
            }),
            rightOf: refusalOf(source, {
              kind: "changeNotePlacement",
              target,
              placement: "rightOf",
            }),
            over: refusalOf(source, {
              kind: "changeNotePlacement",
              target,
              placement: "over",
            }),
          },
          deleteRestriction: refusalOf(source, { kind: "deleteNote", target }),
        });
        break;
      case "blockStart": {
        const branchKeyword = branchKeywordOf(item.block);
        entries.push({
          kind: "blockStart",
          target,
          depth,
          ...wrapOf(statement, target),
          unwrapRestriction: refusalOf(source, { kind: "unwrapBlock", target }),
          branchKeyword,
          addBranchRestriction: refusalOf(source, {
            kind: "addBranch",
            target,
            text: PLACEHOLDER_TEXT,
          }),
          block: item.block,
          displayText: decodeSequenceText(item.text, BLOCK_FIELD),
          textRestriction:
            item.block === SEQUENCE_COLOUR_BLOCK
              ? "colourBlock"
              : textRestriction(item.text),
        });
        depth += 1;
        break;
      }
      case "branch":
        // A branch sits at the level of its block's header.
        entries.push({
          kind: "branch",
          target,
          depth: Math.max(depth - 1, 0),
          block: item.branch,
          displayText: decodeSequenceText(item.text, BLOCK_FIELD),
          textRestriction: textRestriction(item.text),
          deleteRestriction: refusalOf(source, {
            kind: "deleteBranch",
            target,
          }),
        });
        break;
      case "blockEnd":
        depth = Math.max(depth - 1, 0);
        entries.push({ kind: "blockEnd", target, depth, block: item.block });
        break;
      default:
        break;
    }
  });

  const autonumberStatements = reading.statements.filter(
    (statement) => statement.kind === "autonumber",
  );
  const autonumberRefusal = refusalOf(source, {
    kind: "setAutonumber",
    enabled: autonumberStatements.length === 0,
  });
  const autonumber: SequenceAutonumberView =
    autonumberRefusal !== null
      ? { state: "custom", restriction: autonumberRefusal }
      : autonumberStatements.length === 0
        ? { state: "off", restriction: null }
        : { state: "on", restriction: null };

  const titleRefusal = refusalOf(source, {
    kind: "setTitle",
    title: PLACEHOLDER_TEXT,
  });
  return {
    title: decodeSequenceText(meaning.title, TITLE_FIELD),
    titleRestriction:
      titleRefusal ??
      (meaning.title === "" ? null : textRestriction(meaning.title)),
    autonumber,
    participants: meaning.participants.map((participant) => ({
      id: participant.id,
      displayLabel: labelFor(participant.id),
      kind: participant.kind,
      restriction: textRestriction(participant.label),
      deleteRestriction: refusalOf(source, {
        kind: "deleteParticipant",
        participantId: participant.id,
      }),
      moveLeftRestriction: refusalOf(source, {
        kind: "reorderParticipants",
        participantId: participant.id,
        direction: "left",
      }),
      moveRightRestriction: refusalOf(source, {
        kind: "reorderParticipants",
        participantId: participant.id,
        direction: "right",
      }),
    })),
    entries,
  };
}
