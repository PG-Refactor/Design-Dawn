import { type DomainResult, err, ok } from "../../shared/domain-result";
import { applyTextEdits, type TextEdit } from "../text-edit";
import type { SequenceParticipantKind } from "./sequence-config";
import { sequenceEditability } from "./sequence-editability";
import {
  describeSequenceDifferences,
  type SequenceItemMeaning,
  type SequenceMeaning,
  type SequenceParticipantMeaning,
} from "./sequence-meaning";
import { SEQUENCE_ALIAS_LEAD } from "./sequence-operation-config";
import { readSequence, type SequenceReading } from "./sequence-reader";
import type { SequenceStatement } from "./sequence-types";

// Shared by the operations: reading the source, finding the thing an operation names, and
// proving a set of edits against the meaning it promised.

export interface PreparedSequence {
  readonly reading: SequenceReading;
  readonly meaning: SequenceMeaning;
}

// An entry of the item list, named by its position and by what it holds. Both must agree, so
// a target made from an older text cannot silently name another entry.
export interface SequenceItemTarget {
  readonly index: number;
  readonly fingerprint: string;
}

export function refuse<T>(reason: string, detail: string): DomainResult<T> {
  return err("invalidDiagramOperation", `${reason}: ${detail}`);
}

export function prepareSequence(
  source: string,
): DomainResult<PreparedSequence> {
  const reading = readSequence(source);
  const editability = sequenceEditability(reading);
  if (!editability.editable) {
    return err(
      "diagramNotEditable",
      `${editability.reason}: ${editability.detail}`,
    );
  }
  if (reading.meaning === null) {
    return err(
      "diagramNotEditable",
      "unsupportedStatements: the meaning of the text could not be established",
    );
  }
  return ok({ reading, meaning: reading.meaning });
}

// What an entry holds, without where it came from. Two entries that are the same text give
// the same fingerprint; the position tells them apart.
export function fingerprintOfItem(item: SequenceItemMeaning): string {
  const { statementIndex: _statementIndex, ...rest } = item;
  if (rest.kind === "activation") {
    const { viaSign: _viaSign, ...activation } = rest;
    return JSON.stringify(activation);
  }
  return JSON.stringify(rest);
}

export function targetOfItem(
  index: number,
  item: SequenceItemMeaning,
): SequenceItemTarget {
  return { index, fingerprint: fingerprintOfItem(item) };
}

export interface ResolvedItem<K extends SequenceStatement["kind"]> {
  readonly index: number;
  readonly item: SequenceItemMeaning;
  readonly statement: Extract<SequenceStatement, { kind: K }>;
}

// Finds the entry a target names and the statement that wrote it, which must be of one of the
// expected kinds.
export function resolveItem<K extends SequenceStatement["kind"]>(
  prepared: PreparedSequence,
  target: SequenceItemTarget,
  statementKinds: readonly K[],
): DomainResult<ResolvedItem<K>> {
  const { reading, meaning } = prepared;
  const item = Number.isInteger(target.index)
    ? meaning.items[target.index]
    : undefined;
  if (item === undefined) {
    return refuse("targetNotFound", `no entry at index ${target.index}`);
  }
  if (fingerprintOfItem(item) !== target.fingerprint) {
    return refuse(
      "targetMismatch",
      `entry ${target.index} is not what the target describes`,
    );
  }
  const statement = reading.statements.find(
    (candidate) => candidate.index === item.statementIndex,
  );
  if (
    statement === undefined ||
    !(statementKinds as readonly string[]).includes(statement.kind)
  ) {
    return refuse(
      "wrongTargetKind",
      `entry ${target.index} is not a ${statementKinds.join(" / ")}`,
    );
  }
  return ok({
    index: target.index,
    item,
    statement: statement as Extract<SequenceStatement, { kind: K }>,
  });
}

// The position of the last entry a statement wrote (a message with `+` or `-` wrote
// several).
export function lastItemIndexOf(
  meaning: SequenceMeaning,
  statementIndex: number,
): number {
  let last = -1;
  meaning.items.forEach((item, index) => {
    if (item.statementIndex === statementIndex) last = index;
  });
  return last;
}

export function participantOf(
  meaning: SequenceMeaning,
  participantId: string,
): SequenceParticipantMeaning | undefined {
  return meaning.participants.find(
    (participant) => participant.id === participantId,
  );
}

// The participants a statement creates (its first mention), in the order Mermaid adds them.
export function participantsCreatedBy(
  meaning: SequenceMeaning,
  statementIndex: number,
): readonly SequenceParticipantMeaning[] {
  const created = meaning.participants.filter(
    (participant) => participant.firstMention.statementIndex === statementIndex,
  );
  return created;
}

export interface Candidate {
  readonly text: string;
}

// Proves a candidate text: it must read as an editable sequence diagram whose meaning is
// exactly the expected one.
export function checkSequenceMeaning(
  candidate: SequenceReading,
  expected: SequenceMeaning,
): DomainResult<void> {
  const editability = sequenceEditability(candidate);
  if (!editability.editable) {
    return err(
      "diagramNotEditable",
      `candidate ${editability.reason}: ${editability.detail}`,
    );
  }
  if (candidate.meaning === null) {
    return err(
      "diagramNotEditable",
      "candidate meaning: the meaning of the text could not be established",
    );
  }
  const differences = describeSequenceDifferences(candidate.meaning, expected);
  return differences.length === 0
    ? ok(undefined)
    : err(
        "diagramMeaningMismatch",
        `meaningMismatch: ${differences.join("; ")}`,
      );
}

// Applies the edits and proves the result. Pure and cheap (no rendering).
export function candidateOf(
  source: string,
  edits: readonly TextEdit[],
  expected: SequenceMeaning,
): DomainResult<Candidate> {
  const applied = applyTextEdits(source, edits);
  if (!applied.ok) return applied;
  const checked = checkSequenceMeaning(
    readSequence(applied.value.text),
    expected,
  );
  if (!checked.ok) return checked;
  return ok({ text: applied.value.text });
}

// The last line of defence of a plan that has only one way to be written: if its own
// candidate does not read back as promised, the operation is refused instead of handed out.
export function confirmEdits(
  source: string,
  edits: readonly TextEdit[],
  expected: SequenceMeaning,
): DomainResult<void> {
  if (edits.length === 0) return ok(undefined);
  const candidate = candidateOf(source, edits, expected);
  if (candidate.ok) return ok(undefined);
  return refuse("planUnverified", candidate.error.detail);
}

// ---------------------------------------------------------------------------------------
// What every operation hands out

export interface SequenceOperationPlan {
  readonly edits: readonly TextEdit[];
  readonly expected: SequenceMeaning;
}

export type Planned = DomainResult<SequenceOperationPlan>;

export const NO_EDITS: readonly TextEdit[] = [];

// A plan is only handed out after it proved itself (`confirmEdits`).
export function planned(
  source: string,
  edits: readonly TextEdit[],
  expected: SequenceMeaning,
): Planned {
  const confirmed = confirmEdits(source, edits, expected);
  if (!confirmed.ok) return confirmed;
  return ok({ edits, expected });
}

export function declarationText(
  kind: SequenceParticipantKind,
  id: string,
  alias: string | null,
): string {
  return `${kind} ${id}${alias === null ? "" : `${SEQUENCE_ALIAS_LEAD}${alias}`}`;
}
