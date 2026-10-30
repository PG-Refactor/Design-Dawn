import type { SequenceItemMeaning } from "./sequence-meaning";

// Which `+` / `activate` is closed by which `-` / `deactivate`. Mermaid counts activations per
// participant, so a close always ends the most recent open one of its participant. An edit that
// changes who closes whom would redraw the diagram differently without being a mistake
// Mermaid can report, so the operations compare the pairing before and after.

export interface ActivationPairing {
  // False when a close has no open activation (Mermaid rejects such a diagram).
  readonly valid: boolean;
  // The statement that opened -> the statement that closed it. Opens that are never closed
  // are not here.
  readonly pairs: ReadonlyMap<number, number>;
}

export function pairActivations(
  items: readonly SequenceItemMeaning[],
): ActivationPairing {
  const open = new Map<string, number[]>();
  const pairs = new Map<number, number>();
  let valid = true;
  for (const item of items) {
    if (item.kind !== "activation") continue;
    const stack = open.get(item.participant) ?? [];
    if (item.active) {
      stack.push(item.statementIndex);
      open.set(item.participant, stack);
    } else {
      const opener = stack.pop();
      if (opener === undefined) valid = false;
      else pairs.set(opener, item.statementIndex);
    }
  }
  return { valid, pairs };
}

// True when every pair that does not involve an ignored statement is the same before and
// after.
export function pairingPreserved(
  before: ActivationPairing,
  after: ActivationPairing,
  ignored: ReadonlySet<number>,
): boolean {
  const involved = (opener: number, closer: number): boolean =>
    ignored.has(opener) || ignored.has(closer);
  for (const [opener, closer] of before.pairs) {
    if (!involved(opener, closer) && after.pairs.get(opener) !== closer) {
      return false;
    }
  }
  for (const [opener, closer] of after.pairs) {
    if (!involved(opener, closer) && before.pairs.get(opener) !== closer) {
      return false;
    }
  }
  return true;
}
