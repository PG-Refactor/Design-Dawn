import type { TextEdit } from "../text-edit";
import { pairActivations } from "./sequence-activation";
import {
  deleteLinesEdits,
  occupiesWholeLine,
  removeStatementEdits,
  replaceStatementEdit,
} from "./sequence-edit-lines";
import {
  declarationText,
  type Planned,
  type PreparedSequence,
  participantsCreatedBy,
  planned,
  refuse,
} from "./sequence-operation-support";

// Removes whole statements and proves the rest still means what it meant. Shared by
// `deleteParticipant` and `deleteBranch`. What it guarantees:
// - a participant that a removed statement was the first to mention, and that is not being
//   dropped, is declared where that statement stood, so it keeps its column and its place;
// - an activation and the statement that closes it go together (never one without the other),
//   and what is left pairs exactly as before;
// - every edit stays inside one statement or one whole line.
export function planStatementRemoval(
  source: string,
  prepared: PreparedSequence,
  removed: ReadonlySet<number>,
  dropped: ReadonlySet<string>,
): Planned {
  const { reading, meaning } = prepared;
  const keptItems = meaning.items.filter(
    (item) => !removed.has(item.statementIndex),
  );
  const before = pairActivations(meaning.items);
  const after = pairActivations(keptItems);
  for (const [opener, closer] of before.pairs) {
    if (removed.has(opener) !== removed.has(closer)) {
      return refuse(
        "activationPairing",
        "an activation and the message that ends it would be separated",
      );
    }
  }
  for (const [opener, closer] of after.pairs) {
    if (before.pairs.get(opener) !== closer) {
      return refuse(
        "activationPairing",
        "the remaining activations would pair differently",
      );
    }
  }
  if (!after.valid) {
    return refuse(
      "activationPairing",
      "a deactivation would have no activation to end",
    );
  }
  const removedStatements = reading.statements.filter((statement) =>
    removed.has(statement.index),
  );
  const perLine = new Map<number, number>();
  for (const statement of removedStatements) {
    if (statement.kind === "participant" && !dropped.has(statement.id.text)) {
      return refuse(
        "declarationInRange",
        `the declaration of ${statement.id.text} would be removed`,
      );
    }
    perLine.set(
      statement.lineIndex,
      (perLine.get(statement.lineIndex) ?? 0) + 1,
    );
  }
  if ([...perLine.values()].some((count) => count > 1)) {
    return refuse(
      "statementsShareLine",
      "several statements to remove share a line",
    );
  }
  const edits: TextEdit[] = [];
  const wholeLines = new Set<number>();
  const redeclared = new Set<string>();
  for (const statement of removedStatements) {
    const created = participantsCreatedBy(meaning, statement.index).filter(
      (participant) => !dropped.has(participant.id),
    );
    if (created.length > 0) {
      for (const participant of created) redeclared.add(participant.id);
      edits.push(
        replaceStatementEdit(
          reading,
          statement,
          created.map((participant) =>
            declarationText("participant", participant.id, null),
          ),
        ),
      );
    } else if (occupiesWholeLine(reading, statement)) {
      wholeLines.add(statement.lineIndex);
    } else {
      edits.push(...removeStatementEdits(reading, statement));
    }
  }
  edits.push(...deleteLinesEdits(reading, wholeLines));
  return planned(source, edits, {
    ...meaning,
    participants: meaning.participants
      .filter((participant) => !dropped.has(participant.id))
      .map((participant) =>
        redeclared.has(participant.id)
          ? { ...participant, declared: true }
          : participant,
      ),
    items: keptItems,
  });
}
