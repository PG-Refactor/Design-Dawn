// TEST ONLY. Turns the domain's SequenceMeaning into the shape the Mermaid db reading has
// (mermaid-sequence-db.ts) and compares the two. No Mermaid import here.
import type {
  SequenceItemMeaning,
  SequenceMeaning,
} from "../../../domain/diagram/sequence/sequence-meaning";
import {
  type ComparableSequence,
  comparableAutonumber,
  comparableParticipant,
} from "./mermaid-sequence-db";

function itemOf(item: SequenceItemMeaning): string {
  switch (item.kind) {
    case "message":
      return `msg ${item.from}>${item.to} ${item.arrow} ${JSON.stringify(item.text)}${item.activates ? " +" : ""}`;
    case "note":
      return `note ${item.placement} ${item.participants[0]}>${item.participants[1] ?? item.participants[0]} ${JSON.stringify(item.text)}`;
    case "activation":
      return `${item.active ? "act+" : "act-"} ${item.participant}`;
    case "blockStart":
      return `blockStart ${item.block} ${JSON.stringify(item.text)}`;
    case "branch":
      return `branch ${item.branch} ${JSON.stringify(item.text)}`;
    case "blockEnd":
      // Mermaid ends `par_over` with the entry of `par`.
      return `blockEnd ${item.block === "par_over" ? "par" : item.block}`;
    case "autonumber":
      return comparableAutonumber(item.visible, item.start, item.step);
  }
}

export function comparableOf(meaning: SequenceMeaning): ComparableSequence {
  return {
    participants: meaning.participants.map((participant) =>
      comparableParticipant(
        participant.id,
        participant.label,
        participant.kind,
      ),
    ),
    items: meaning.items.map(itemOf),
    title: meaning.title,
    chainConsistent: meaning.layoutChainConsistent,
  };
}

// The first difference as a short text, or null when the two are the same.
export function firstDifference(
  actual: ComparableSequence,
  expected: ComparableSequence,
): string | null {
  if (actual.participants.join("\n") !== expected.participants.join("\n")) {
    return `participants: reader ${actual.participants.join(",")} / mermaid ${expected.participants.join(",")}`;
  }
  const length = Math.max(actual.items.length, expected.items.length);
  for (let position = 0; position < length; position += 1) {
    if (actual.items[position] !== expected.items[position]) {
      return `item ${position}: reader ${actual.items[position] ?? "(none)"} / mermaid ${expected.items[position] ?? "(none)"}`;
    }
  }
  if (actual.title !== expected.title) {
    return `title: reader ${actual.title} / mermaid ${expected.title}`;
  }
  if (actual.chainConsistent !== expected.chainConsistent) {
    return `column chain: reader ${actual.chainConsistent} / mermaid ${expected.chainConsistent}`;
  }
  return null;
}
