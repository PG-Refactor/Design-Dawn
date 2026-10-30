import {
  SEQUENCE_BRANCH_OWNERS,
  SEQUENCE_DEFAULT_AUTONUMBER_STEP,
  type SequenceArrow,
  type SequenceBlock,
  type SequenceBranch,
  type SequenceNotePlacement,
  type SequenceParticipantKind,
} from "./sequence-config";
import type { SequenceStatement } from "./sequence-types";

// What Mermaid 12.1.0 holds after reading a sequence diagram (its sequence db), derived from
// the recognised statements by replaying Mermaid's own rules.
// It is built only when the whole text was understood: never a partial meaning.
// Items are Mermaid's flat message list: a `+` or `-` on a message adds an activation entry
// right after it, exactly as the db does, so the two are compared entry by entry.

export interface SequenceParticipantMeaning {
  readonly id: string;
  // The alias, or the id when there is none.
  readonly label: string;
  readonly kind: SequenceParticipantKind;
  // True when a `participant` / `actor` statement wrote it (otherwise a message or note
  // created it implicitly, at its first mention).
  readonly declared: boolean;
  readonly firstMention: { readonly statementIndex: number };
}

interface ItemBase {
  // The statement that produced the entry. Not part of the meaning that is compared.
  readonly statementIndex: number;
}

export interface SequenceMessageItem extends ItemBase {
  readonly kind: "message";
  readonly from: string;
  readonly to: string;
  readonly arrow: SequenceArrow;
  readonly text: string;
  // Written with `+`: the next entry is the activation it causes.
  readonly activates: boolean;
}

export interface SequenceNoteItem extends ItemBase {
  readonly kind: "note";
  readonly placement: SequenceNotePlacement;
  // One participant, or two for `over A,B`.
  readonly participants: readonly string[];
  readonly text: string;
}

export interface SequenceActivationItem extends ItemBase {
  readonly kind: "activation";
  readonly active: boolean;
  readonly participant: string;
  // True when a `+` / `-` on a message caused it, false for `activate` / `deactivate`.
  readonly viaSign: boolean;
}

export interface SequenceBlockStartItem extends ItemBase {
  readonly kind: "blockStart";
  readonly block: SequenceBlock;
  readonly text: string;
}

export interface SequenceBranchItem extends ItemBase {
  readonly kind: "branch";
  readonly branch: SequenceBranch;
  readonly text: string;
}

export interface SequenceBlockEndItem extends ItemBase {
  readonly kind: "blockEnd";
  readonly block: SequenceBlock;
}

export interface SequenceAutonumberItem extends ItemBase {
  readonly kind: "autonumber";
  readonly visible: boolean;
  readonly start: number | null;
  readonly step: number | null;
}

export type SequenceItemMeaning =
  | SequenceMessageItem
  | SequenceNoteItem
  | SequenceActivationItem
  | SequenceBlockStartItem
  | SequenceBranchItem
  | SequenceBlockEndItem
  | SequenceAutonumberItem;

export interface SequenceMeaning {
  // In the order Mermaid draws the columns: the order of first mention.
  readonly participants: readonly SequenceParticipantMeaning[];
  readonly items: readonly SequenceItemMeaning[];
  // The last `title` statement; empty when there is none.
  readonly title: string;
  // Mermaid links every column to its neighbours (prev / next) in the order the
  // participants were added. A participant declared again after it was known breaks that
  // chain (the layout uses it), which is why such a diagram is not edited.
  readonly layoutChainConsistent: boolean;
  // Participants that a `participant` / `actor` statement declared although they already
  // existed (a repeated declaration, or one after the first message that mentions them).
  readonly redeclaredParticipants: readonly string[];
}

export type SequenceInvalidReason =
  | "endWithoutBlock"
  | "branchOutsideItsBlock"
  | "unclosedBlock"
  | "deactivationWithoutActivation"
  | "activationOfUnknownParticipant";

export type SequenceMeaningResult =
  | { readonly ok: true; readonly meaning: SequenceMeaning }
  | {
      readonly ok: false;
      readonly reason: SequenceInvalidReason;
      readonly detail: string;
    };

interface ParticipantRecord {
  id: string;
  label: string;
  kind: SequenceParticipantKind;
  declared: boolean;
  firstMention: number;
  previous: string | undefined;
  next: string | undefined;
}

// Replays the statements the way Mermaid's db does. The rules are the measured ones of the
// research: a message or note creates the participants it
// names at their first mention; a `participant` statement that names an existing
// participant changes nothing unless it gives an alias, and then replaces the record (which
// is what breaks the previous / next chain); a `-` or `deactivate` needs an open activation.
export function buildSequenceMeaning(
  statements: readonly SequenceStatement[],
): SequenceMeaningResult {
  const records = new Map<string, ParticipantRecord>();
  let previousId: string | undefined;
  const redeclared: string[] = [];
  const items: SequenceItemMeaning[] = [];
  const openBlocks: SequenceBlock[] = [];
  const activationUses: { id: string; statementIndex: number }[] = [];
  let title = "";

  const addParticipant = (
    id: string,
    label: string | undefined,
    kind: SequenceParticipantKind | undefined,
    declared: boolean,
    statementIndex: number,
  ): void => {
    const old = records.get(id);
    if (declared && old !== undefined) redeclared.push(id);
    if (old !== undefined && label === undefined) return;
    records.set(id, {
      id,
      label: label ?? id,
      kind: kind ?? "participant",
      declared: declared || old?.declared === true,
      firstMention: old?.firstMention ?? statementIndex,
      previous: previousId,
      next: undefined,
    });
    if (previousId !== undefined) {
      const previous = records.get(previousId);
      if (previous !== undefined) previous.next = id;
    }
    previousId = id;
  };

  const openActivations = (id: string): number => {
    let count = 0;
    for (const item of items) {
      if (item.kind === "activation" && item.participant === id) {
        count += item.active ? 1 : -1;
      }
    }
    return count;
  };

  const invalid = (
    reason: SequenceInvalidReason,
    detail: string,
  ): SequenceMeaningResult => ({ ok: false, reason, detail });

  for (const statement of statements) {
    switch (statement.kind) {
      case "participant":
        addParticipant(
          statement.id.text,
          statement.alias?.text,
          statement.declaration,
          true,
          statement.index,
        );
        break;
      case "message": {
        addParticipant(
          statement.from.text,
          undefined,
          undefined,
          false,
          statement.index,
        );
        addParticipant(
          statement.to.text,
          undefined,
          undefined,
          false,
          statement.index,
        );
        const activates = statement.sign?.text === "+";
        items.push({
          kind: "message",
          statementIndex: statement.index,
          from: statement.from.text,
          to: statement.to.text,
          arrow: statement.arrowValue,
          text: statement.messageText.text,
          activates,
        });
        if (activates) {
          items.push({
            kind: "activation",
            statementIndex: statement.index,
            active: true,
            participant: statement.to.text,
            viaSign: true,
          });
        }
        if (statement.sign?.text === "-") {
          if (openActivations(statement.from.text) < 1) {
            return invalid(
              "deactivationWithoutActivation",
              `line ${statement.lineIndex + 1}: ${statement.from.text} is not active`,
            );
          }
          items.push({
            kind: "activation",
            statementIndex: statement.index,
            active: false,
            participant: statement.from.text,
            viaSign: true,
          });
        }
        break;
      }
      case "note":
        for (const id of statement.ids) {
          addParticipant(id.text, undefined, undefined, false, statement.index);
        }
        items.push({
          kind: "note",
          statementIndex: statement.index,
          placement: statement.placement,
          participants: statement.ids.map((id) => id.text),
          text: statement.noteText.text,
        });
        break;
      case "activation":
        activationUses.push({
          id: statement.id.text,
          statementIndex: statement.index,
        });
        if (!statement.activate && openActivations(statement.id.text) < 1) {
          return invalid(
            "deactivationWithoutActivation",
            `line ${statement.lineIndex + 1}: ${statement.id.text} is not active`,
          );
        }
        items.push({
          kind: "activation",
          statementIndex: statement.index,
          active: statement.activate,
          participant: statement.id.text,
          viaSign: false,
        });
        break;
      case "blockStart":
        openBlocks.push(statement.block);
        items.push({
          kind: "blockStart",
          statementIndex: statement.index,
          block: statement.block,
          text: statement.label.text,
        });
        break;
      case "branch": {
        const owner = openBlocks[openBlocks.length - 1];
        if (
          owner === undefined ||
          !SEQUENCE_BRANCH_OWNERS[statement.branch].includes(owner)
        ) {
          return invalid(
            "branchOutsideItsBlock",
            `line ${statement.lineIndex + 1}: ${statement.branch} is not inside its block`,
          );
        }
        items.push({
          kind: "branch",
          statementIndex: statement.index,
          branch: statement.branch,
          text: statement.label.text,
        });
        break;
      }
      case "blockEnd": {
        const block = openBlocks.pop();
        if (block === undefined) {
          return invalid(
            "endWithoutBlock",
            `line ${statement.lineIndex + 1}: end closes nothing`,
          );
        }
        items.push({
          kind: "blockEnd",
          statementIndex: statement.index,
          block,
        });
        break;
      }
      case "autonumber":
        items.push({
          kind: "autonumber",
          statementIndex: statement.index,
          visible: statement.visible,
          start: statement.start,
          step: statement.step,
        });
        break;
      case "title":
        title = statement.title.text;
        break;
    }
  }
  if (openBlocks.length > 0) {
    return invalid("unclosedBlock", `${openBlocks.length} block(s) not closed`);
  }
  // `activate X` does not create X; Mermaid parses it but cannot draw a diagram in which X
  // never exists.
  for (const use of activationUses) {
    if (!records.has(use.id)) {
      return invalid(
        "activationOfUnknownParticipant",
        `${use.id} is activated but never appears`,
      );
    }
  }
  const ordered = [...records.values()];
  const ids = ordered.map((record) => record.id);
  return {
    ok: true,
    meaning: {
      participants: ordered.map((record) => ({
        id: record.id,
        label: record.label,
        kind: record.kind,
        declared: record.declared,
        firstMention: { statementIndex: record.firstMention },
      })),
      items,
      title,
      layoutChainConsistent: ordered.every(
        (record, position) =>
          record.previous === ids[position - 1] &&
          record.next === ids[position + 1],
      ),
      redeclaredParticipants: [...new Set(redeclared)],
    },
  };
}

// Autonumber's `step` is 1 when only a start is given.
export function autonumberStep(
  start: number | null,
  step: number | null,
): number | null {
  if (start === null) return null;
  return step ?? SEQUENCE_DEFAULT_AUTONUMBER_STEP;
}

// ---------------------------------------------------------------------------------------
// Comparison

// The item without the fields that only say where it came from.
function comparableItem(item: SequenceItemMeaning): string {
  const { statementIndex: _statementIndex, ...rest } = item;
  if (rest.kind === "activation") {
    const { viaSign: _viaSign, ...activation } = rest;
    return JSON.stringify(activation);
  }
  return JSON.stringify(rest);
}

function participantLine(participant: SequenceParticipantMeaning): string {
  return `${participant.id}${participant.label === participant.id ? "" : `=${participant.label}`}${participant.kind === "participant" ? "" : `:${participant.kind}`}`;
}

// Lists how two meanings differ; empty when they are the same. What is compared is what
// Mermaid itself holds (and what the user sees): the participants in order with label and
// kind, the item list entry by entry, the title and the column chain. `declared`, the
// first-mention positions and the statement indexes are not part of the comparison.
export function describeSequenceDifferences(
  actual: SequenceMeaning,
  expected: SequenceMeaning,
): readonly string[] {
  const differences: string[] = [];
  const actualParticipants = actual.participants.map(participantLine);
  const expectedParticipants = expected.participants.map(participantLine);
  if (actualParticipants.join("\n") !== expectedParticipants.join("\n")) {
    differences.push(
      `participants: got ${actualParticipants.join(",")} want ${expectedParticipants.join(",")}`,
    );
  }
  const actualItems = actual.items.map(comparableItem);
  const expectedItems = expected.items.map(comparableItem);
  if (actualItems.join("\n") !== expectedItems.join("\n")) {
    let position = 0;
    while (
      position < actualItems.length &&
      position < expectedItems.length &&
      actualItems[position] === expectedItems[position]
    ) {
      position += 1;
    }
    differences.push(
      `items@${position}: got ${actualItems[position] ?? "(end)"} want ${expectedItems[position] ?? "(end)"} (${actualItems.length}/${expectedItems.length} items)`,
    );
  }
  if (actual.title !== expected.title) {
    differences.push(`title: got ${actual.title} want ${expected.title}`);
  }
  if (actual.layoutChainConsistent !== expected.layoutChainConsistent) {
    differences.push(
      `column chain: got ${actual.layoutChainConsistent} want ${expected.layoutChainConsistent}`,
    );
  }
  return differences;
}
