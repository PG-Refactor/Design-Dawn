import type {
  SequenceItemMeaning,
  SequenceMeaning,
  SequenceParticipantMeaning,
} from "./sequence-meaning";

// "Meaning before + what the operation meant": the expected meaning of an edit, built
// without looking at the text the edit produces. Pure functions on the meaning; the
// operations (sequence-operations.ts) decide WHICH of these an operation is, and
// `checkSequenceMeaning` proves that the written text reads back the same.

export function withParticipant(
  meaning: SequenceMeaning,
  participantId: string,
  patch: Partial<SequenceParticipantMeaning>,
): SequenceMeaning {
  return {
    ...meaning,
    participants: meaning.participants.map((participant) =>
      participant.id === participantId
        ? { ...participant, ...patch }
        : participant,
    ),
  };
}

export function withParticipantInserted(
  meaning: SequenceMeaning,
  position: number,
  participant: SequenceParticipantMeaning,
): SequenceMeaning {
  return {
    ...meaning,
    participants: [
      ...meaning.participants.slice(0, position),
      participant,
      ...meaning.participants.slice(position),
    ],
  };
}

export function withItemReplaced(
  meaning: SequenceMeaning,
  index: number,
  item: SequenceItemMeaning,
): SequenceMeaning {
  return {
    ...meaning,
    items: meaning.items.map((existing, position) =>
      position === index ? item : existing,
    ),
  };
}

export function withItemInserted(
  meaning: SequenceMeaning,
  index: number,
  item: SequenceItemMeaning,
): SequenceMeaning {
  return {
    ...meaning,
    items: [
      ...meaning.items.slice(0, index),
      item,
      ...meaning.items.slice(index),
    ],
  };
}

export function withItemRemoved(
  meaning: SequenceMeaning,
  index: number,
): SequenceMeaning {
  return {
    ...meaning,
    items: meaning.items.filter((_, position) => position !== index),
  };
}

export function withItemsSwapped(
  meaning: SequenceMeaning,
  first: number,
  second: number,
): SequenceMeaning {
  const items = [...meaning.items];
  const firstItem = items[first];
  const secondItem = items[second];
  if (firstItem === undefined || secondItem === undefined) return meaning;
  items[first] = secondItem;
  items[second] = firstItem;
  return { ...meaning, items };
}

export function withTitle(
  meaning: SequenceMeaning,
  title: string,
): SequenceMeaning {
  return { ...meaning, title };
}
