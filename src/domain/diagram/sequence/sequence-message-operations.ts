import { ok } from "../../shared/domain-result";
import type { TextEdit } from "../text-edit";
import { pairActivations, pairingPreserved } from "./sequence-activation";
import {
  SEQUENCE_ACTIVATE_SIGN,
  SEQUENCE_DEACTIVATE_SIGN,
} from "./sequence-config";
import {
  indentOfLine,
  insertLineAfterEdit,
  isLastOnLine,
} from "./sequence-edit-lines";
import type { SequenceItemMeaning } from "./sequence-meaning";
import { withItemInserted } from "./sequence-meaning-edit";
import {
  SEQUENCE_COPY_COLON,
  SEQUENCE_MESSAGE_COLON,
  SEQUENCE_UNKNOWN_STATEMENT_INDEX,
} from "./sequence-operation-config";
import {
  lastItemIndexOf,
  NO_EDITS,
  type Planned,
  type PreparedSequence,
  planned,
  refuse,
  resolveItem,
  type SequenceItemTarget,
} from "./sequence-operation-support";

// Tier 2 operations on single messages (docs/architecture.md §16.16.9).

export type SequenceActivationSign = "+" | "-" | null;

export interface SetMessageActivationOperation {
  readonly kind: "setMessageActivation";
  readonly target: SequenceItemTarget;
  // `+` activates the receiver, `-` deactivates the sender, null writes neither.
  readonly sign: SequenceActivationSign;
}

export interface DuplicateMessageOperation {
  readonly kind: "duplicateMessage";
  readonly target: SequenceItemTarget;
}

// Changes the `+` / `-` of a message. The activations of the other messages must pair exactly
// as before: a `+` that loses its `-` (or the other way round) is not guessed at, the user
// removes the `-` first. An activation that is left open is valid Mermaid and stays open to
// the end of the diagram.
export function planSetMessageActivation(
  source: string,
  prepared: PreparedSequence,
  operation: SetMessageActivationOperation,
): Planned {
  const { meaning } = prepared;
  if (
    operation.sign !== null &&
    operation.sign !== SEQUENCE_ACTIVATE_SIGN &&
    operation.sign !== SEQUENCE_DEACTIVATE_SIGN
  ) {
    return refuse("invalidSign", `unknown sign ${String(operation.sign)}`);
  }
  const resolved = resolveItem(prepared, operation.target, ["message"]);
  if (!resolved.ok) return resolved;
  const { index, item, statement } = resolved.value;
  if (item.kind !== "message")
    return refuse("wrongTargetKind", "not a message");
  const current = statement.sign?.text ?? null;
  if (current === operation.sign) {
    return ok({ edits: NO_EDITS, expected: meaning });
  }
  // The entries of this message: itself, then the activation its sign caused.
  const hasActivationItem = current !== null;
  const nextItem = meaning.items[index + 1];
  const items: SequenceItemMeaning[] = meaning.items.filter(
    (candidate, position) =>
      !(
        hasActivationItem &&
        position === index + 1 &&
        nextItem?.kind === "activation" &&
        nextItem.statementIndex === statement.index
      ) && candidate !== item,
  );
  const message = {
    ...item,
    activates: operation.sign === SEQUENCE_ACTIVATE_SIGN,
  };
  const insertAt = index;
  const rebuilt = [
    ...items.slice(0, insertAt),
    message,
    ...items.slice(insertAt),
  ];
  if (operation.sign !== null) {
    rebuilt.splice(insertAt + 1, 0, {
      kind: "activation",
      statementIndex: statement.index,
      active: operation.sign === SEQUENCE_ACTIVATE_SIGN,
      participant:
        operation.sign === SEQUENCE_ACTIVATE_SIGN ? item.to : item.from,
      viaSign: true,
    });
  }
  const before = pairActivations(meaning.items);
  const after = pairActivations(rebuilt);
  if (!after.valid) {
    return refuse(
      "activationPairing",
      "a deactivation would have no activation to end",
    );
  }
  if (!pairingPreserved(before, after, new Set([statement.index]))) {
    return refuse(
      "activationPairing",
      "the activations of the other messages would pair differently",
    );
  }
  const edit: TextEdit =
    statement.sign === null
      ? {
          start: statement.to.span.start,
          end: statement.to.span.start,
          text: operation.sign ?? "",
        }
      : {
          start: statement.sign.span.start,
          end: statement.sign.span.end,
          text: operation.sign ?? "",
        };
  return planned(source, [edit], { ...meaning, items: rebuilt });
}

// Writes a copy of the message right behind it, without a `+` / `-` (a copy of those would
// open or close an activation a second time).
export function planDuplicateMessage(
  source: string,
  prepared: PreparedSequence,
  operation: DuplicateMessageOperation,
): Planned {
  const { reading, meaning } = prepared;
  const resolved = resolveItem(prepared, operation.target, ["message"]);
  if (!resolved.ok) return resolved;
  const { item, statement } = resolved.value;
  if (item.kind !== "message")
    return refuse("wrongTargetKind", "not a message");
  if (!isLastOnLine(reading, statement)) {
    return refuse("sharedLine", "the message is followed by another statement");
  }
  const text =
    statement.messageText.text === ""
      ? SEQUENCE_MESSAGE_COLON
      : `${SEQUENCE_COPY_COLON}${statement.messageText.text}`;
  const line = `${indentOfLine(reading, statement.lineIndex)}${statement.from.text}${statement.arrow.text}${statement.to.text}${text}`;
  const copy: SequenceItemMeaning = {
    ...item,
    statementIndex: SEQUENCE_UNKNOWN_STATEMENT_INDEX,
    activates: false,
  };
  return planned(
    source,
    [insertLineAfterEdit(reading, statement.lineIndex, line)],
    withItemInserted(
      meaning,
      lastItemIndexOf(meaning, statement.index) + 1,
      copy,
    ),
  );
}
