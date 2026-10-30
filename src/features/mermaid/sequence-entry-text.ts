import type { SequenceEntryView } from "../../domain/diagram/sequence/sequence-view";
import type { MermaidMessages } from "./mermaid-messages";

type SequenceMessages = MermaidMessages["gui"]["sequence"];

// Single-line text of a label for a list row (line breaks shown as blanks).
export function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ");
}

// The row text of an entry of the flow list, also its accessible name.
export function describeEntry(
  text: SequenceMessages,
  entry: SequenceEntryView,
): string {
  switch (entry.kind) {
    case "message":
      return text.messageOption(
        oneLine(entry.fromLabel),
        oneLine(entry.toLabel),
        entry.arrow,
        oneLine(entry.displayText),
        entry.activation === null ? "" : text.activationMarks[entry.activation],
      );
    case "note":
      return text.noteOption(
        text.placements[entry.placement],
        entry.participantLabels.map(oneLine).join(", "),
        oneLine(entry.displayText),
      );
    case "blockStart":
      return text.blockOption(
        text.blocks[entry.block],
        oneLine(entry.displayText),
      );
    case "branch":
      return text.branchOption(
        text.blocks[entry.block],
        oneLine(entry.displayText),
      );
    case "blockEnd":
      return text.endOption(text.blocks[entry.block]);
  }
}

// The key of an entry in the list: its position and what it holds.
export function entryKey(entry: SequenceEntryView): string {
  return `${entry.target.index}:${entry.target.fingerprint}`;
}
