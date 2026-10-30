import type { TextEdit } from "../text-edit";
import {
  insertStatementsBeforeEdit,
  removeStatementEdits,
} from "./sequence-edit-lines";
import type { SequenceParticipantMeaning } from "./sequence-meaning";
import {
  declarationText,
  type Planned,
  type PreparedSequence,
  participantOf,
  participantsCreatedBy,
  planned,
  refuse,
} from "./sequence-operation-support";
import { planStatementRemoval } from "./sequence-removal";

// Tier 2 operations on participants (docs/architecture.md §16.16.9).

export interface DeleteParticipantOperation {
  readonly kind: "deleteParticipant";
  readonly participantId: string;
}

export interface ReorderParticipantsOperation {
  readonly kind: "reorderParticipants";
  readonly participantId: string;
  // One column to the left or to the right.
  readonly direction: "left" | "right";
}

// Deletes a participant and everything that involves it: its declaration, every message from
// or to it, every note that is only about it and every `activate` / `deactivate`. A note that
// also names another participant is not guessed at: the user deletes or changes the note first.
export function planDeleteParticipant(
  source: string,
  prepared: PreparedSequence,
  operation: DeleteParticipantOperation,
): Planned {
  const { reading, meaning } = prepared;
  const id = operation.participantId;
  if (participantOf(meaning, id) === undefined) {
    return refuse("participantNotFound", `no participant ${id}`);
  }
  const removed = new Set<number>();
  for (const statement of reading.statements) {
    switch (statement.kind) {
      case "participant":
        if (statement.id.text === id) removed.add(statement.index);
        break;
      case "message":
        if (statement.from.text === id || statement.to.text === id) {
          removed.add(statement.index);
        }
        break;
      case "activation":
        if (statement.id.text === id) removed.add(statement.index);
        break;
      case "note": {
        const names = statement.ids.map((token) => token.text);
        if (!names.includes(id)) break;
        if (names.some((name) => name !== id)) {
          return refuse(
            "noteSpansParticipants",
            "a note also names another participant; delete or change the note first",
          );
        }
        removed.add(statement.index);
        break;
      }
      default:
        break;
    }
  }
  return planStatementRemoval(source, prepared, removed, new Set([id]));
}

// Moves a participant one column. The column order is the order of first mention, so the move
// is: the right one of the two neighbours is declared in front of the first mention of the
// left one. Its old declaration (if it had one) goes, and a statement that mentions the left
// one for the first time together with others first declares those others, so no other
// column moves.
export function planReorderParticipants(
  source: string,
  prepared: PreparedSequence,
  operation: ReorderParticipantsOperation,
): Planned {
  const { reading, meaning } = prepared;
  const position = meaning.participants.findIndex(
    (participant) => participant.id === operation.participantId,
  );
  if (position === -1) {
    return refuse(
      "participantNotFound",
      `no participant ${operation.participantId}`,
    );
  }
  const leftPosition = operation.direction === "left" ? position - 1 : position;
  const left = meaning.participants[leftPosition];
  const right = meaning.participants[leftPosition + 1];
  if (left === undefined || right === undefined) {
    return refuse("atBoundary", "there is no column on that side");
  }
  const anchor = reading.statements[left.firstMention.statementIndex];
  if (anchor === undefined) {
    return refuse("firstMentionNotFound", `${left.id} is not written`);
  }
  const createdThere = participantsCreatedBy(meaning, anchor.index);
  const inFront = createdThere
    .slice(
      0,
      createdThere.findIndex((participant) => participant.id === left.id),
    )
    .map((participant) => declarationText("participant", participant.id, null));
  const rightDeclaration = reading.statements.find(
    (statement) =>
      statement.kind === "participant" && statement.id.text === right.id,
  );
  const edits: TextEdit[] = [
    insertStatementsBeforeEdit(reading, anchor, [
      ...inFront,
      rightDeclaration === undefined
        ? declarationText("participant", right.id, null)
        : rightDeclaration.text,
    ]),
  ];
  if (rightDeclaration !== undefined) {
    edits.push(...removeStatementEdits(reading, rightDeclaration));
  }
  const declaredNow = new Set([
    right.id,
    ...createdThere
      .slice(0, inFront.length)
      .map((participant) => participant.id),
  ]);
  const swapped: SequenceParticipantMeaning[] = [...meaning.participants];
  swapped[leftPosition] = right;
  swapped[leftPosition + 1] = left;
  const expected = {
    ...meaning,
    participants: swapped.map((participant) =>
      declaredNow.has(participant.id)
        ? { ...participant, declared: true }
        : participant,
    ),
  };
  return planned(source, edits, expected);
}
