import type {
  SequenceArrow,
  SequenceBlock,
  SequenceBranch,
  SequenceNotePlacement,
  SequenceParticipantKind,
} from "./sequence-config";
import { SEQUENCE_COLOUR_BLOCK } from "./sequence-config";
import {
  prepareSequence,
  type SequenceItemTarget,
  targetOfItem,
} from "./sequence-operation-support";
import {
  planSequenceOperation,
  type SequenceOperation,
} from "./sequence-operations";
import { decodeSequenceText, writtenTextRestriction } from "./sequence-text";

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
}

interface EntryBase {
  // The target sent back to the operations (position in the item list and what it holds).
  readonly target: SequenceItemTarget;
  // How many blocks the entry is inside of (a block header and its `end` are at the depth
  // of the block's surroundings).
  readonly depth: number;
}

export interface SequenceMessageEntry extends EntryBase {
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
}

export interface SequenceNoteEntry extends EntryBase {
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

export interface SequenceBlockEntry extends EntryBase {
  readonly kind: "blockStart" | "branch";
  readonly block: SequenceBlock | SequenceBranch;
  readonly displayText: string;
  readonly textRestriction: string | null;
}

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
      case "blockStart":
        entries.push({
          kind: "blockStart",
          target,
          depth,
          block: item.block,
          displayText: decodeSequenceText(item.text, BLOCK_FIELD),
          textRestriction:
            item.block === SEQUENCE_COLOUR_BLOCK
              ? "colourBlock"
              : textRestriction(item.text),
        });
        depth += 1;
        break;
      case "branch":
        // A branch sits at the level of its block's header.
        entries.push({
          kind: "branch",
          target,
          depth: Math.max(depth - 1, 0),
          block: item.branch,
          displayText: decodeSequenceText(item.text, BLOCK_FIELD),
          textRestriction: textRestriction(item.text),
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
    })),
    entries,
  };
}
