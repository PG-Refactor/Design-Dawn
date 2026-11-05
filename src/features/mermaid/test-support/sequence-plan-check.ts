// TEST ONLY. Checks a plan of a sequence operation against the real Mermaid 12.3.0: it must
// accept the new text, read it as the meaning the operation promised, draw it (the app's
// render check), and the edits must be undoable to the exact old text.

import {
  planSequenceOperation,
  type SequenceOperation,
  verifySequenceCandidate,
} from "../../../domain/diagram/sequence/sequence-operations";
import {
  applyTextEdits,
  type TextEdit,
} from "../../../domain/diagram/text-edit";
import { createDiagramRenderCheck } from "../diagram-render-check";
import { mermaidRenderer } from "../render-mermaid";
import {
  type ComparableSequence,
  readSequenceWithMermaid,
} from "./mermaid-sequence-db";
import { comparableOf, firstDifference } from "./sequence-comparison";

const renderCheck = createDiagramRenderCheck(mermaidRenderer);

// The exact inverse of a set of edits applied to `source`: applying it to the result gives
// `source` back.
export function invert(source: string, edits: readonly TextEdit[]): TextEdit[] {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let delta = 0;
  const inverse: TextEdit[] = [];
  for (const edit of sorted) {
    const start = edit.start + delta;
    inverse.push({
      start,
      end: start + edit.text.length,
      text: source.slice(edit.start, edit.end),
    });
    delta += edit.text.length - (edit.end - edit.start);
  }
  return inverse;
}

export async function mermaidSays(
  source: string,
): Promise<ComparableSequence | null> {
  const reading = await readSequenceWithMermaid(source);
  return reading.accepted ? reading.sequence : null;
}

// A plan that was handed out: the text must be accepted, read and drawn by Mermaid exactly
// as promised, and undoable.
export async function checkPlanAgainstMermaid(
  label: string,
  source: string,
  operation: SequenceOperation,
): Promise<string | null> {
  const result = planSequenceOperation(source, operation);
  if (!result.ok) return null;
  const applied = applyTextEdits(source, result.value.edits);
  if (!applied.ok) return `${label}: ${applied.error.detail}`;
  const text = applied.value.text;
  const verified = verifySequenceCandidate(text, result.value.expected);
  if (!verified.ok) return `${label}: unverified ${verified.error.detail}`;
  const reference = await mermaidSays(text);
  if (reference === null)
    return `${label}: mermaid rejects ${JSON.stringify(text)}`;
  const difference = firstDifference(
    comparableOf(result.value.expected),
    reference,
  );
  if (difference !== null)
    return `${label}: ${difference}\n${JSON.stringify(text)}`;
  const drawn = await renderCheck(text);
  if (!drawn.ok)
    return `${label}: does not draw (${drawn.message.slice(0, 100)})`;
  const undone = applyTextEdits(text, invert(source, result.value.edits));
  if (!undone.ok || undone.value.text !== source) {
    return `${label}: the edits are not undoable`;
  }
  return null;
}
